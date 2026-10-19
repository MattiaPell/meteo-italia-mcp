import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiGet, toToolResult } from "../http.js";
import { haversine } from "../geo.js";

// ---------------------------------------------------------------------------
// ARPA Marche / AMAP Agrometeo — stazioni meteorologiche
// https://apimeteo.regione.marche.it/ (API REST JSON, CC BY)
// https://meteo.regione.marche.it/OpenData
// ---------------------------------------------------------------------------

const API_BASE = "https://apimeteo.regione.marche.it";

export interface ArpaMarcheStation {
  codice: string;
  nome: string;
  comune: string;
  provincia: string;
  latitudine: number;
  longitudine: number;
  altitudine: number;
  attiva: boolean;
  proprietario: string;
  ultimoAggiornamento: string | null;
  sensori: Array<{
    id: number;
    tipo: string;
    haGiornalieri: boolean;
  }>;
}

/** Parse coordinate from DMS string like "43°36'6.340''" to decimal. */
export function dmsToDecimal(dms: string): number {
  const m = dms.match(/(\d+)°(\d+)'([\d.]+)''/);
  if (!m) return 0;
  const deg = parseFloat(m[1]);
  const min = parseFloat(m[2]) / 60;
  const sec = parseFloat(m[3]) / 3600;
  const sign = deg >= 0 ? 1 : -1;
  return sign * (Math.abs(deg) + min + sec);
}

/** Parse stations from raw API list response. */
export function parseStationList(raw: any): ArpaMarcheStation[] {
  const items: any[] = raw?.lista ?? [];
  return items.map((s: any) => ({
    codice: s.codice ?? "",
    nome: s.nome ?? "",
    comune: s.comune ?? "",
    provincia: s.provincia ?? "",
    latitudine: s.latitudine || dmsToDecimal(s.latString ?? ""),
    longitudine: s.longitudine || dmsToDecimal(s.longString ?? ""),
    altitudine: parseFloat(s.altitudine) || 0,
    attiva: (s.statoCodice ?? "") === "ATTIVA",
    proprietario: s.proprietario ?? "",
    ultimoAggiornamento: s.fine ?? null,
    sensori: [],
  }));
}

/** Parse station detail including sensor list. */
export function parseStationDetail(raw: any, base: ArpaMarcheStation): ArpaMarcheStation {
  const sensors = raw?.listaSensori?.lista ?? [];
  return {
    ...base,
    altitudine: parseFloat(raw.altitudine) || base.altitudine,
    sensori: sensors.map((sen: any) => ({
      id: sen.idSensoreStazione ?? 0,
      tipo: sen.descrizioneClasse ?? "",
      haGiornalieri: sen.haGiornalieri ?? false,
    })),
  };
}

let cachedStations: any[] | null = null;
let cachedStationsTime = 0;

async function getStationsCached() {
  if (cachedStations && Date.now() - cachedStationsTime < 3600000) {
    return { ok: true, lista: cachedStations };
  }
  const stazioniR = await apiGet("https://apimeteo.regione.marche.it/Stazioni", { attive: true });
  if (!stazioniR.ok) return { ok: false, error: stazioniR.error };
  cachedStations = (stazioniR.data as any)?.lista ?? [];
  cachedStationsTime = Date.now();
  return { ok: true, lista: cachedStations };
}

// --- Adapter per brief.ts (Marche) ------------------------------------------
export async function runBriefArpa(lat: number, lon: number): Promise<any> {
  const stazioniR = await getStationsCached();
  if (!stazioniR.ok) return { ok: false, agenzia: "ARPA Marche (AMAP)", error: stazioniR.error };
  const items: any[] = stazioniR.lista ?? [];
  let best: any = null;
  for (const s of items) {
    const slat = s.latitudine ?? 0;
    const slon = s.longitudine ?? 0;
    if (!slat || !slon) continue;
    const d = haversine({ lat, lon }, { lat: slat, lon: slon });
    if (!best || d < best.distKm)
      best = {
        codice: s.codice,
        nome: s.nome,
        comune: s.comune,
        provincia: s.provincia,
        lat: slat,
        lon: slon,
        distKm: Math.round(d * 10) / 10,
        ultimoAgg: s.fine,
      };
  }
  if (!best) return { ok: false, agenzia: "ARPA Marche (AMAP)", error: "nessuna stazione vicina" };
  const dettaglio = await apiGet(`https://apimeteo.regione.marche.it/Stazione/${best.codice}`, {});
  return {
    ok: true,
    agenzia: "ARPA Marche / AMAP Agrometeo",
    stazioneVicina: best,
    sensori: dettaglio.ok
      ? ((dettaglio.data as any)?.listaSensori?.lista ?? []).map((sen: any) => ({
          id: sen.idSensoreStazione,
          tipo: sen.descrizioneClasse,
          giornalieri: sen.haGiornalieri,
        }))
      : [],
  };
}

export async function handleArpaMarcheStazioni({ provincia, attive }: { provincia?: string; attive?: boolean }) {
  const attiveParam = attive !== false; // default true
  const r = await apiGet(`${API_BASE}/Stazioni`, { attive: attiveParam });
  if (!r.ok) return toToolResult(r);

  const stations = parseStationList(r.data as any);
  const filtered = provincia ? stations.filter((s) => s.provincia.toUpperCase() === provincia.toUpperCase()) : stations;

  return toToolResult({
    ...r,
    data: {
      fonte: "AMAP Agrometeo — Regione Marche (CC BY)",
      totale: filtered.length,
      stazioni: filtered,
    },
  });
}

export async function handleArpaMarcheStazione({ codice }: { codice: string }) {
  const r = await apiGet(`${API_BASE}/Stazione/${codice}`, {});
  if (!r.ok) return toToolResult(r);

  const raw = r.data as any;
  const base: ArpaMarcheStation = {
    codice: raw.codice ?? codice,
    nome: raw.nome ?? "",
    comune: raw.comune ?? "",
    provincia: raw.provincia ?? "",
    latitudine: raw.latitudine ?? dmsToDecimal(raw.latString ?? ""),
    longitudine: raw.longitudine ?? dmsToDecimal(raw.longString ?? ""),
    altitudine: parseFloat(raw.altitudine) || 0,
    attiva: (raw.statoCodice ?? "") === "ATTIVA",
    proprietario: raw.proprietario ?? "",
    ultimoAggiornamento: raw.fine ?? null,
    sensori: [],
  };
  const detail = parseStationDetail(raw, base);

  return toToolResult({
    ...r,
    data: {
      fonte: "AMAP Agrometeo — Regione Marche (CC BY)",
      stazione: detail,
    },
  });
}

export async function handleArpaMarcheGrandezze() {
  const r = await apiGet(`${API_BASE}/Grandezze`, {});
  if (!r.ok) return toToolResult(r);

  return toToolResult({
    ...r,
    data: {
      fonte: "AMAP Agrometeo — Regione Marche (CC BY)",
      grandezze: (r.data as any)?.lista ?? [],
    },
  });
}

export function registerArpaMarche(server: McpServer) {
  // --- ARPA Marche elenco stazioni ----------------------------------------
  server.registerTool(
    "arpa_marche_stazioni",
    {
      title: "ARPA Marche Stazioni Meteorologiche",
      description:
        "Elenco delle stazioni meteo della rete AMAP Agrometeo Marche. Include coordinate, altitudine, provincia e data ultimo aggiornamento. Fonte: apimeteo.regione.marche.it (CC BY).",
      inputSchema: {
        provincia: z
          .string()
          .optional()
          .describe("Filtra per sigla provincia (AN, AP, FM, MC, PU). Omesso = tutte le province."),
        attive: z.boolean().optional().describe("Solo stazioni attive (default: true)."),
      },
      outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleArpaMarcheStazioni,
  );

  // --- ARPA Marche dettaglio stazione -------------------------------------
  server.registerTool(
    "arpa_marche_stazione",
    {
      title: "ARPA Marche Dettaglio Stazione",
      description:
        "Dettaglio di una stazione meteo AMAP Marche con elenco sensori disponibili (temperatura, vento, pioggia, umidità, pressione, ecc.).",
      inputSchema: {
        codice: z.string().describe("Codice stazione (es. ST01, ST32, ST60)."),
      },
      outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleArpaMarcheStazione,
  );

  // --- ARPA Marche grandezze disponibili ----------------------------------
  server.registerTool(
    "arpa_marche_grandezze",
    {
      title: "ARPA Marche Grandezze Misurate",
      description:
        "Elenco delle grandezze meteorologiche misurate dalla rete AMAP Marche (temperatura, precipitazione, vento, umidità, radiazione, ecc.) con codice, unità di misura e periodo.",
      inputSchema: {},
      outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleArpaMarcheGrandezze,
  );
}
