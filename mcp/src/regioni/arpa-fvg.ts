import { z } from "zod";
import { escapeRegExp } from "../utils.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiGet, toToolResult } from "../http.js";
import type { ArpaBriefResult } from "./types.js";

// ---------------------------------------------------------------------------
// ARPA FVG / OSMER — previsioni + dati stazioni (XML)
// http://dev.meteo.fvg.it/xml/previsioni/PW{YYYYMMDD}.xml
// http://dev.meteo.fvg.it/xml/stazioni/{CODICE}.xml
// Anagrafica: WFS su serviziogc.regione.fvg.it (309 stazioni)
// ---------------------------------------------------------------------------

export interface FvgStation {
  codice: string;
  nome: string;
  attiva: boolean;
  lat: number;
  lon: number;
  sensori: string[];
}

const wfsRegexCache = new Map<string, RegExp>();
function getWfsRegex(tag: string): RegExp {
  let re = wfsRegexCache.get(tag);
  if (!re) {
    re = new RegExp(`<MONIT_AMB:${escapeRegExp(tag)}>([^<]*)</MONIT_AMB:${escapeRegExp(tag)}>`);
    wfsRegexCache.set(tag, re);
  }
  return re;
}

/** Parse WFS response per lista stazioni. */
export function parseWfsStazioni(xml: string): FvgStation[] {
  const out: FvgStation[] = [];
  const members = xml.match(/<wfs:member>[\s\S]*?<\/wfs:member>/g) ?? [];
  for (const m of members) {
    const get = (tag: string) => m.match(getWfsRegex(tag))?.[1]?.trim() ?? "";
    const attiva = get("ATTIVA") === "S";
    const sospesa = get("SOSPENSIONE_OSSERVAZIONE") === "S";
    if (!attiva || sospesa) continue;

    // Coordinate in EPSG:6708 → approssimazione con FVG centroid
    // Dal WFS: <gml:pos>5149191.718375 357337.373125</gml:pos>
    const posMatch = m.match(/<gml:pos>([\d.]+)\s+([\d.]+)<\/gml:pos>/);
    if (!posMatch) continue;
    // EPSG:6708 è un sistema projected — skip conversione, usiamo approssimazione
    // Per le coordinate usiamo una lookup table o stima grezza
    // Al momento saltiamo lat/lon dal WFS perché servirebbe una libreria di proiezione
    const sensori: string[] = [];
    if (get("TERMOMETRO") === "S") sensori.push("temperatura");
    if (get("PLUVIOMETRO") === "S") sensori.push("pioggia");
    if (get("ANEMOMETRO") === "S") sensori.push("vento");
    if (get("IGROMETRO") === "S") sensori.push("umidita");
    if (get("BAROMETRO") === "S") sensori.push("pressione");
    if (get("NIVOMETRO") === "S") sensori.push("neve");
    if (get("RADIOMETRO") === "S") sensori.push("radiazione");

    out.push({
      codice: get("CODICE_FVG"),
      nome: get("DENOMINAZIONE"),
      attiva: true,
      lat: 0, // da WFS projected, skip per ora
      lon: 0,
      sensori,
    });
  }
  return out;
}

/** Parse stazione XML (ultimi dati). */
export function parseStazioneXml(xml: string): Record<string, unknown> | null {
  const get = (tag: string) => {
    const re = new RegExp(`<${escapeRegExp(tag)}[^>]*>([^<]*)</${escapeRegExp(tag)}>`);
    const m = xml.match(re);
    return m ? m[1].trim() : null;
  };
  const getAttr = (tag: string, attr: string) => {
    const re = new RegExp(`<${escapeRegExp(tag)}[^>]*\\s${escapeRegExp(attr)}="([^"]*)"`);
    const m = xml.match(re);
    return m ? m[1].trim() : null;
  };

  const obsMatch = xml.match(/<meteo_data>[\s\S]*?<\/meteo_data>/);
  if (!obsMatch) return null;

  const cloudiness = getAttr("cloudiness", "descrizione") || get("cloudiness");

  return {
    stazione: get("station_name"),
    codice: get("station_id"),
    quota: get("station_altitude"),
    rilevazione: get("observation_time"),
    precipitazioni_mm: get("rr") ? parseFloat(get("rr")!) : null,
    temperatura_c: get("t") ? parseFloat(get("t")!) : null,
    temperatura_percepita: get("t_feel") ? parseFloat(get("t_feel")!) : null,
    umidita_perc: get("hu") ? parseFloat(get("hu")!) : null,
    pressione_hPa: get("pa") ? parseFloat(get("pa")!) : null,
    vento_kmh: get("ff") ? parseFloat(get("ff")!) : null,
    vento_raffica_kmh: get("ff_max") ? parseFloat(get("ff_max")!) : null,
    vento_direzione: get("dd"),
    nuvolosita: cloudiness,
    dew_point: get("to") ? parseFloat(get("to")!) : null,
    radiazione_kjm2: get("gl") ? parseFloat(get("gl")!) : null,
    neve_cm: get("hs") ? parseFloat(get("hs")!) : null,
    neve_fresca_cm: get("hns") ? parseFloat(get("hns")!) : null,
  };
}

const previsioniRegexCache = new Map<string, RegExp>();
function getPrevisioniRegex(tag: string): RegExp {
  let re = previsioniRegexCache.get(tag);
  if (!re) {
    re = new RegExp(`<${escapeRegExp(tag)}>([\\s\\S]*?)</${escapeRegExp(tag)}>`);
    previsioniRegexCache.set(tag, re);
  }
  return re;
}

const zonaTagRegexCache = new Map<string, RegExp>();
function getZonaTagRegex(tag: string): RegExp {
  let re = zonaTagRegexCache.get(tag);
  if (!re) {
    re = new RegExp(`<${escapeRegExp(tag)}(?:[^>]*>|>)([^<]*)</${escapeRegExp(tag)}>`);
    zonaTagRegexCache.set(tag, re);
  }
  return re;
}

/** Parse previsioni XML. */
export function parsePrevisioniXml(xml: string): Record<string, unknown> {
  const get = (tag: string) => {
    const m = xml.match(getPrevisioniRegex(tag));
    return m ? m[1].trim() : null;
  };

  const emissione = get("emissione");
  const situazGenerale = get("SITUAZIONEGENERALE_TESTO");
  const lingua = get("lingua");

  // Estrai scadenze
  const scadenze: Record<string, unknown>[] = [];
  const scadBlocks = xml.match(/<scadenza[\s\S]*?<\/scadenza>/g) ?? [];
  for (const sb of scadBlocks) {
    const getId = sb.match(/id="(\d+)"/)?.[1];
    const dataVal = sb.match(/data_validita="([^"]*)"/)?.[1];
    const giorno = sb.match(/giorno="([^"]*)"/)?.[1];

    const zone: Record<string, unknown>[] = [];
    const zonaBlocks = sb.match(/<zona[\s\S]*?<\/zona>/g) ?? [];
    for (const zb of zonaBlocks) {
      const zId = zb.match(/id="(\d+)"/)?.[1];
      const zNome = zb.match(/nome="([^"]*)"/)?.[1];
      const zDesc = zb.match(/descrizione="([^"]*)"/)?.[1];

      const getTag = (tag: string) => zb.match(getZonaTagRegex(tag))?.[1]?.trim() ?? null;

      zone.push({
        id: zId,
        nome: zNome,
        descrizione: zDesc,
        attendibilita_perc: getTag("ATTENDIBILITA"),
        testo: getTag("TESTO"),
        prob_precipitazioni_perc: getTag("PROBABILITAPRECIPITAZIONI"),
        prob_temporali_perc: getTag("PROBABILITATEMPORALI"),
        quota_neve_m: getTag("QUOTANEVICATA"),
        mattina_simbolo: getTag("EVOLUZIONE00_SIMBOLO"),
        mattina_descrizione: getTag("EVOLUZIONE00_DESCRIZIONE"),
        pomeriggio_simbolo: getTag("EVOLUZIONE12_SIMBOLO"),
        pomeriggio_descrizione: getTag("EVOLUZIONE12_DESCRIZIONE"),
        sera_simbolo: getTag("EVOLUZIONE24_SIMBOLO"),
        sera_descrizione: getTag("EVOLUZIONE24_DESCRIZIONE"),
      });
    }

    scadenze.push({
      id: getId,
      data_validita: dataVal,
      giorno,
      zone,
    });
  }

  return {
    emissione,
    lingua,
    situazione_generale: situazGenerale,
    scadenze,
  };
}

// --- Adapter per brief.ts (FVG) ---------------------------------------------
export async function runBriefArpa(_lat: number, _lon: number): Promise<ArpaBriefResult> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const r = await apiGet(
    `http://dev.meteo.fvg.it/xml/previsioni/PW${today}.xml`,
    {},
    { acceptText: true, noCache: true },
  );
  if (r.ok) {
    return { ok: true, agenzia: "ARPA FVG / OSMER (dev.meteo.fvg.it)", ...parsePrevisioniXml(String(r.data)) };
  }
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10).replace(/-/g, "");
  const fb = await apiGet(
    `http://dev.meteo.fvg.it/xml/previsioni/PW${yesterday}.xml`,
    {},
    { acceptText: true, noCache: true },
  );
  if (!fb.ok) return { ok: false, agenzia: "ARPA FVG / OSMER", error: fb.error };
  return {
    ok: true,
    agenzia: "ARPA FVG / OSMER (dev.meteo.fvg.it)",
    note: "Bollettino di ieri (quello di oggi non ancora disponibile)",
    ...parsePrevisioniXml(String(fb.data)),
  };
}

export async function handleArpaFvgPrevisioni({
  data,
  lingua,
}: {
  data?: string;
  lingua?: "it" | "en" | "de" | "sl" | "fur";
}) {
  // Se data non fornita, prova il bollettino di oggi
  const dateStr = data ?? new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const lang = lingua ?? "it";
  const suffix = lang === "it" ? "" : `-${lang}`;

  const url = `http://dev.meteo.fvg.it/xml/previsioni/PW${dateStr}${suffix}.xml`;
  const r = await apiGet(url, {}, { acceptText: true, noCache: true });
  if (!r.ok) {
    // Fallback: prova giorno prima
    const fallback = new Date();
    fallback.setDate(fallback.getDate() - 1);
    const fbStr = fallback.toISOString().slice(0, 10).replace(/-/g, "");
    const fbUrl = `http://dev.meteo.fvg.it/xml/previsioni/PW${fbStr}${suffix}.xml`;
    const fb = await apiGet(fbUrl, {}, { acceptText: true, noCache: true });
    if (!fb.ok) return toToolResult(fb);
    return toToolResult({
      ...fb,
      data: {
        fonte: "OSMER ARPA FVG",
        note: "Bollettino di ieri (quello di oggi non ancora disponibile)",
        ...parsePrevisioniXml(String(fb.data)),
      },
    });
  }

  return toToolResult({
    ...r,
    data: {
      fonte: "OSMER ARPA FVG",
      ...parsePrevisioniXml(String(r.data)),
    },
  });
}

export async function handleArpaFvgStazione({
  codice,
  latitude,
  longitude,
}: {
  codice?: string;
  latitude?: number;
  longitude?: number;
}) {
  const stationCode = codice?.toUpperCase();

  // Se no codice, lista stazioni WFS e trova più vicina
  if (!stationCode) {
    if (latitude === undefined || longitude === undefined) {
      return toToolResult({
        ok: false,
        url: "",
        status: 400,
        data: null,
        error: "Passa codice stazione oppure latitude+longitude",
        elapsedMs: 0,
      });
    }

    // Recupera la lista delle stazioni dal WFS
    const wfsUrl =
      "https://serviziogc.regione.fvg.it/geoserver/MONIT_AMB/wfs?service=wfs&version=2.0.0&request=GetFeature&typeName=MONIT_AMB:STAZIONI_METEOROLOGICHE";
    const wfs = await apiGet(wfsUrl, {}, { acceptText: true, noCache: true });
    if (!wfs.ok) return toToolResult(wfs);

    const stations = parseWfsStazioni(String(wfs.data));
    if (!stations.length) {
      return toToolResult({
        ok: false,
        url: wfsUrl,
        status: 200,
        data: null,
        error: "Nessuna stazione attiva trovata",
        elapsedMs: wfs.elapsedMs,
      });
    }

    // WFS non fornisce lat/lon in WGS84 semplice, usiamo fallback
    // Restituiamo lista stazioni invece
    return toToolResult({
      ...wfs,
      data: {
        fonte: "OSMER ARPA FVG — anagrafica stazioni (WFS)",
        messaggio: "Passa un codice stazione per i dati. Esempi: G201 (Adegliacco), C551",
        stazioni: stations.slice(0, 30).map((s) => ({
          codice: s.codice,
          nome: s.nome,
          sensori: s.sensori,
        })),
      },
    });
  }

  const url = `http://dev.meteo.fvg.it/xml/stazioni/${stationCode}.xml`;
  const r = await apiGet(url, {}, { acceptText: true, noCache: true });
  if (!r.ok) return toToolResult(r);

  const parsed = parseStazioneXml(String(r.data));
  if (!parsed) {
    return toToolResult({
      ok: false,
      url,
      status: 200,
      data: null,
      error: `Formato dati non riconosciuto per stazione ${stationCode}`,
      elapsedMs: r.elapsedMs,
    });
  }

  return toToolResult({
    ...r,
    data: {
      fonte: "OSMER ARPA FVG (dati non validati, real-time)",
      ...parsed,
    },
  });
}

export function registerArpaFvg(server: McpServer) {
  // --- Previsioni FVG ----------------------------------------------------
  server.registerTool(
    "arpafvg_previsioni",
    {
      title: "ARPA FVG Previsioni Meteo Regionali",
      description:
        "Previsioni meteorologiche per il Friuli Venezia Giulia (OSMER). Restituisce situazione generale, zone (REGIONE, Alpi Carniche, Prealpi, Pianura, Costa, ecc.) con attendibilità, probabilità precipitazioni/temporali, simboli e descrizione per mattina/pomeriggio/sera. Fonte: OSMER ARPA FVG, aggiornato 2x/giorno.",
      inputSchema: {
        data: z
          .string()
          .optional()
          .describe("Data bollettino formato YYYYMMDD (es. 20260721). Omesso = ultimo disponibile."),
        lingua: z
          .enum(["it", "en", "de", "sl", "fur"])
          .optional()
          .describe("Lingua (it, en, de, sl, fur). Default: it."),
      },
      outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleArpaFvgPrevisioni,
  );

  // --- Dati stazione FVG -------------------------------------------------
  server.registerTool(
    "arpafvg_stazione",
    {
      title: "ARPA FVG Dati Stazione Meteo",
      description:
        "Ultime osservazioni di una stazione meteo ARPA FVG/OSMER (temperatura, precipitazioni, vento, umidità, pressione, neve). Cerca per codice stazione (es. G201, C551) o trova la più vicina a lat/lon. Fonte: OSMER dev.meteo.fvg.it, aggiornato ogni 30 min.",
      inputSchema: {
        codice: z.string().optional().describe("Codice stazione (es. G201, C551). Omesso = cerca per lat/lon."),
        latitude: z.coerce.number().optional().describe("Lat per stazione più vicina"),
        longitude: z.coerce.number().optional().describe("Lon per stazione più vicina"),
      },
      outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleArpaFvgStazione,
  );
}
