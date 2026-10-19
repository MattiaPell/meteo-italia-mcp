import { escapeRegExp } from "../utils.js";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiGet, toToolResult } from "../http.js";
import { haversine } from "../geo.js";
import type { ArpaBriefResult } from "./types.js";

// ---------------------------------------------------------------------------
// ARPAV (Veneto) — previsioni per 15 zone + livelli idrometrici
// https://api.arpa.veneto.it/REST/v1/bollettini_meteo_simboli_en
//   (previsione per 15 zone, JSON, CC BY 4.0) e
// https://www.arpa.veneto.it/api/risorse/data-meteo/xml/Ultime48ore.xml
//   (livelli idrometrici 103 stazioni, ultime 48h, XML).
//   NOTA: il vecchio path /rest/v1/meteo/stazioni/{id}/dati risponde 404.
// ---------------------------------------------------------------------------

export interface ArpavIdroStation {
  id: string;
  nome: string;
  lat: number;
  lon: number;
  quota: number | null;
  provincia: string;
  comune: string;
  livelloM: number | null;
  livello6hFaM: number | null;
  trend: "salita" | "discesa" | "stabile" | null;
  ultimoRilievo: string | null;
}

/** Parse the ARPAV Ultime48ore.xml hydrometric file (ISO-8859-1). */

const regexCache = new Map<string, RegExp>();
function getTagRegex(tag: string): RegExp {
  let re = regexCache.get(tag);
  if (!re) {
    re = new RegExp(`<${escapeRegExp(tag)}>([\\s\\S]*?)</${escapeRegExp(tag)}>`);
    regexCache.set(tag, re);
  }
  return re;
}

const stripCData = (str: string) => {
  if (str.startsWith("<![CDATA[") && str.endsWith("]]>")) {
    return str.slice(9, -3);
  }
  return str.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
};

export function parseArpavIdroStation(b: string): ArpavIdroStation | null {
  const get = (tag: string) => stripCData(b.match(getTagRegex(tag))?.[1]?.trim() ?? "");
  const datiMatches = [...b.matchAll(/<DATI ISTANTE="(\d{12})"><VM>([-\d.]+)<\/VM><\/DATI>/g)];
  if (!datiMatches.length) return null;
  const points = datiMatches.map((m) => ({
    t: m[1],
    v: parseFloat(m[2]),
  }));
  const last = points[points.length - 1];
  const ref6h = points.length > 36 ? points[points.length - 37] : points[0];
  const delta = ref6h != null ? last.v - ref6h.v : null;
  const fmt = (t: string) =>
    `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(8, 10)}:${t.slice(10, 12)}:00`;
  return {
    id: get("IDSTAZ"),
    nome: get("NOME"),
    lat: parseFloat(get("Y")) || 0,
    lon: parseFloat(get("X")) || 0,
    quota: parseFloat(get("QUOTA")) || null,
    provincia: get("PROVINCIA"),
    comune: get("COMUNE"),
    livelloM: last.v,
    livello6hFaM: ref6h?.v ?? null,
    trend: delta == null ? null : Math.abs(delta) < 0.01 ? "stabile" : delta > 0 ? "salita" : "discesa",
    ultimoRilievo: fmt(last.t),
  };
}

export function parseArpavIdroXml(xml: string): ArpavIdroStation[] {
  const stations: ArpavIdroStation[] = [];
  const blocks = xml.match(/<STAZIONE>[\s\S]*?<\/STAZIONE>/g) ?? [];
  for (const b of blocks) {
    const station = parseArpavIdroStation(b);
    if (station) {
      stations.push(station);
    }
  }
  return stations;
}

/** Riga del bollettino ARPAV (una per zona e giorno). */
interface ArpavBollettinoRow {
  zona?: string;
  giorno?: string | number;
  scadenza?: string;
  testo?: string;
  precipitazioni?: string;
  temperatura?: string;
  "temperatura 1500m"?: string;
  "temperatura 2000m"?: string;
  "temperatura 3000m"?: string;
  attendibilita?: string;
  avvisi?: string | null;
  segnalazioni?: string | null;
  dataemissione?: string;
}

const bollettinoRows = (data: unknown): ArpavBollettinoRow[] =>
  (data as { data?: ArpavBollettinoRow[] } | null)?.data ?? [];

// --- Adapter per brief.ts (Veneto) ------------------------------------------
export async function runBriefArpa(lat: number, lon: number): Promise<ArpaBriefResult> {
  const [bol, idro] = await Promise.all([
    apiGet("https://api.arpa.veneto.it/REST/v1/bollettini_meteo_simboli_en", {}),
    apiGet("https://www.arpa.veneto.it/api/risorse/data-meteo/xml/Ultime48ore.xml", {}, { acceptText: true }),
  ]);
  const zoneRows = bollettinoRows(bol.data)
    .filter((r) => Number(r.giorno) <= 1)
    .map((r) => ({
      zona: r.zona,
      giorno: r.giorno,
      scadenza: r.scadenza,
      cielo: r.testo,
      precipitazioni: r.precipitazioni,
      attendibilita: r.attendibilita,
    }));
  let idroVicino: Array<ArpavIdroStation & { distKm: number }> | null = null;
  if (idro.ok) {
    const stazioni = parseArpavIdroXml(String(idro.data))
      .map((s) => ({ ...s, distKm: Math.round(haversine({ lat, lon }, { lat: s.lat, lon: s.lon }) * 10) / 10 }))
      .sort((a, b) => a.distKm - b.distKm)
      .slice(0, 2);
    idroVicino = stazioni;
  }
  return {
    ok: bol.ok,
    agenzia: "ARPAV (Veneto)",
    bollettino: { emissione: bollettinoRows(bol.data)[0]?.dataemissione ?? null, zone: zoneRows },
    idrometrieVicine: idroVicino,
  };
}

interface ArpavBollettinoArgs {
  zona?: string;
  giorno?: number;
}

async function handleArpavBollettino({ zona, giorno }: ArpavBollettinoArgs) {
  const r = await apiGet("https://api.arpa.veneto.it/REST/v1/bollettini_meteo_simboli_en", {});
  if (!r.ok) return toToolResult(r);
  const rows = bollettinoRows(r.data);
  const norm = (s: string) => s.toLowerCase();
  const filtered = rows.filter((row) => {
    if (giorno !== undefined && Number(row.giorno) !== giorno) return false;
    if (zona && !norm(String(row.zona ?? "")).includes(norm(zona))) return false;
    return true;
  });
  const compact = filtered.map((row) => ({
    zona: row.zona,
    giorno: row.giorno,
    scadenza: row.scadenza,
    cielo: row.testo,
    precipitazioni: row.precipitazioni,
    temperatura: row.temperatura,
    t1500m: row["temperatura 1500m"],
    t2000m: row["temperatura 2000m"],
    t3000m: row["temperatura 3000m"],
    attendibilita: row.attendibilita,
    avvisi: row.avvisi ?? row.segnalazioni ?? null,
  }));
  return toToolResult({
    ...r,
    data: {
      fonte: "ARPAV Centro Meteorologico (CC BY 4.0)",
      emissione: rows[0]?.dataemissione ?? null,
      zone: compact,
      count: compact.length,
    },
  });
}

interface ArpavIdroArgs {
  provincia?: string;
  nome?: string;
  latitude?: number;
  longitude?: number;
  limit: number;
}

async function handleArpavIdro({ provincia, nome, latitude, longitude, limit }: ArpavIdroArgs) {
  const r = await apiGet(
    "https://www.arpa.veneto.it/api/risorse/data-meteo/xml/Ultime48ore.xml",
    {},
    { acceptText: true },
  );
  if (!r.ok) return toToolResult(r);
  let stations = parseArpavIdroXml(String(r.data));
  if (provincia) {
    const p = provincia.toUpperCase();
    stations = stations.filter((s) => s.provincia === p);
  }
  if (nome) {
    const n = nome.toLowerCase();
    stations = stations.filter((s) => s.nome.toLowerCase().includes(n) || s.comune.toLowerCase().includes(n));
  }
  if (latitude !== undefined && longitude !== undefined) {
    stations = stations
      .map((s) => ({
        ...s,
        distKm: Math.round(haversine({ lat: latitude, lon: longitude }, { lat: s.lat, lon: s.lon }) * 10) / 10,
      }))
      .sort((a, b) => a.distKm - b.distKm);
  }
  const out = stations.slice(0, limit);
  return toToolResult({
    ...r,
    data: {
      fonte: "ARPAV rete idrometrica (open data, non validato)",
      stazioniTotali: stations.length,
      stazioni: out,
    },
  });
}

export function registerArpav(server: McpServer) {
  // --- ARPAV bollettino meteo per zone (Veneto) --------------------------
  server.registerTool(
    "arpav_bollettino",
    {
      title: "ARPAV Bollettino Meteo Veneto (15 zone)",
      description:
        "Previsione ARPAV per le 15 zone del Veneto (stato del cielo, precipitazioni, temperature in quota, attendibilità) dal Centro Meteorologico regionale. Fonte ufficiale ARPAV REST (CC BY 4.0), aggiornata ~ogni giorno. Usa sempre per località in Veneto: è la previsione della rete regionale competente.",
      inputSchema: {
        zona: z
          .string()
          .optional()
          .describe(
            "Nome zona (es. 'Pianura polesana', 'Dolomiti Nord-Est', 'Costa'). Match parziale case-insensitive. Omesso = tutte le 15 zone.",
          ),
        giorno: z.coerce
          .number()
          .int()
          .min(0)
          .max(6)
          .optional()
          .describe("0=oggi, 1=domani... Omesso = tutti i giorni disponibili"),
      },
      outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleArpavBollettino,
  );

  // --- ARPAV livelli idrometrici (Veneto) --------------------------------
  server.registerTool(
    "arpav_idro",
    {
      title: "ARPAV Livelli Idrometrici Veneto",
      description:
        "Livelli idrometrici delle 103 stazioni ARPAV (Adige, Piave, Brenta, Bacchiglione, Po...) dalle ultime 48h, con trend a 6h. Filtra per provincia, nome stazione/fiume, o stazione più vicina a lat/lon. Fonte XML open data ARPAV aggiornata in continuo. NOTA: sostituisce il vecchio endpoint /rest/v1/meteo/stazioni (404).",
      inputSchema: {
        provincia: z.string().optional().describe("Sigla provincia (BL, PD, RO, TV, VE, VR, VI)"),
        nome: z.string().optional().describe("Match parziale su nome stazione o fiume (es. 'Adige', 'Bassano')"),
        latitude: z.coerce.number().optional().describe("Lat per stazione più vicina"),
        longitude: z.coerce.number().optional().describe("Lon per stazione più vicina"),
        limit: z.coerce.number().int().min(1).max(103).default(10).describe("Max stazioni in output"),
      },
      outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleArpavIdro,
  );
}
