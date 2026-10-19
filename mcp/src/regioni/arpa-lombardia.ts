import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiGet, toToolResult } from "../http.js";
import { haversine } from "../geo.js";
import type { ArpaBriefResult } from "./types.js";

// ---------------------------------------------------------------------------
// ARPA Lombardia — osservazioni stazioni meteo (Socrata Open Data API)
// https://www.dati.lombardia.it/Ambiente/Dati-sensori-meteo/647i-nhxk
// https://www.dati.lombardia.it/Ambiente/Stazioni-Idro-Nivo-Meteorologiche/nf78-nj6b
// Licenza: CC BY 4.0
// ---------------------------------------------------------------------------

const STAZIONI_URL = "https://www.dati.lombardia.it/resource/nf78-nj6b.json";
const OSSERVAZIONI_URL = "https://www.dati.lombardia.it/resource/647i-nhxk.json";

export interface ArpaLombardiaStation {
  idsensore: string;
  tipologia: string;
  unitaMisura: string;
  idstazione: string;
  nomeStazione: string;
  quota: number | null;
  provincia: string;
  lat: number;
  lon: number;
}

export interface ArpaLombardiaObs {
  idsensore: string;
  data: string;
  valore: string;
  stato: string;
}

/** Riga grezza dell'anagrafica stazioni (Socrata): tutti i valori sono stringhe. */
export interface LombardiaStationRow {
  idsensore?: string;
  tipologia?: string;
  unit_dimisura?: string;
  idstazione?: string;
  nomestazione?: string;
  quota?: string;
  provincia?: string;
  lat?: string;
  lng?: string;
}

/** Parse station from Socrata row. */
export function parseStation(row: LombardiaStationRow): ArpaLombardiaStation {
  return {
    idsensore: row.idsensore ?? "",
    tipologia: row.tipologia ?? "",
    unitaMisura: row.unit_dimisura ?? "",
    idstazione: row.idstazione ?? "",
    nomeStazione: row.nomestazione ?? "",
    quota: parseFloat(row.quota ?? "") || null,
    provincia: row.provincia ?? "",
    lat: parseFloat(row.lat ?? "") || 0,
    lon: parseFloat(row.lng ?? "") || 0,
  };
}

let cachedStazioniPromise: Promise<LombardiaStationRow[]> | null = null;

async function getStationsCached(): Promise<LombardiaStationRow[]> {
  if (cachedStazioniPromise !== null) {
    return cachedStazioniPromise;
  }

  cachedStazioniPromise = (async () => {
    try {
      const stazioniR = await apiGet("https://www.dati.lombardia.it/resource/nf78-nj6b.json", { $limit: "200" });
      if (stazioniR.ok) {
        return (stazioniR.data as LombardiaStationRow[]) ?? [];
      } else {
        cachedStazioniPromise = null;
        return [];
      }
    } catch (e) {
      cachedStazioniPromise = null;
      throw e;
    }
  })();

  return cachedStazioniPromise;
}

// --- Adapter per brief.ts (Lombardia) --------------------------------------
interface NearestStation {
  idsensore: string | undefined;
  nome: string | undefined;
  provincia: string | undefined;
  tipologia: string | undefined;
  quota: string | undefined;
  lat: number;
  lon: number;
  distKm: number;
}

export async function runBriefArpa(lat: number, lon: number): Promise<ArpaBriefResult> {
  const [stazioni, obsR] = await Promise.allSettled([
    getStationsCached(),
    apiGet("https://www.dati.lombardia.it/resource/647i-nhxk.json", {
      $where: `data >= '${new Date(Date.now() - 7200 * 1000).toISOString().replace(/\.\d{3}Z$/, "")}'`,
      $order: "data DESC",
      $limit: "50",
    }),
  ]);
  const stazioniData: LombardiaStationRow[] = stazioni.status === "fulfilled" ? stazioni.value : [];
  let bestObs: NearestStation | null = null;
  for (const s of stazioniData) {
    const slat = parseFloat(s.lat ?? "") || 0;
    const slon = parseFloat(s.lng ?? "") || 0;
    if (!slat || !slon) continue;
    const d = haversine({ lat, lon }, { lat: slat, lon: slon });
    if (!bestObs || d < bestObs.distKm)
      bestObs = {
        idsensore: s.idsensore,
        nome: s.nomestazione,
        provincia: s.provincia,
        tipologia: s.tipologia,
        quota: s.quota,
        lat: slat,
        lon: slon,
        distKm: Math.round(d * 10) / 10,
      };
  }
  const osservazioni: ArpaLombardiaObs[] =
    obsR.status === "fulfilled" && obsR.value.ok
      ? ((obsR.value.data as ArpaLombardiaObs[]) ?? []).filter((o) => o.valore !== "-999")
      : [];
  return {
    ok: true,
    agenzia: "ARPA Lombardia (dati.lombardia.it)",
    stazioneVicina: bestObs,
    osservazioniRecenti: osservazioni.slice(0, 10).map((o) => ({
      data: o.data,
      valore: o.valore,
      stato: o.stato,
    })),
  };
}

export async function handleArpaLombardiaStazioni({
  provincia,
  tipologia,
  limit,
}: {
  provincia?: string;
  tipologia?: string;
  limit?: number;
}) {
  const params: Record<string, string> = {};
  if (provincia) params.provincia = provincia.toUpperCase();
  if (tipologia) params.tipologia = tipologia;
  if (limit) params.$limit = String(limit);
  else params.$limit = "200";

  const r = await apiGet(STAZIONI_URL, params);
  if (!r.ok) return toToolResult(r);

  const rows = (r.data as LombardiaStationRow[]) ?? [];
  const stations = rows.map(parseStation);

  return toToolResult({
    ...r,
    data: {
      fonte: "ARPA Lombardia — CC BY 4.0",
      totale: stations.length,
      stazioni: stations,
    },
  });
}

export async function handleArpaLombardiaOsservazioni({
  provincia,
  tipologia,
  minuti,
  limit,
}: {
  provincia?: string;
  tipologia?: string;
  minuti?: number;
  limit?: number;
}) {
  // Step 1: find sensor IDs matching provincia/tipologia
  const stationParams: Record<string, string> = { $limit: "200" };
  if (provincia) stationParams.provincia = provincia.toUpperCase();
  if (tipologia) stationParams.tipologia = tipologia;
  const stationR = await apiGet(STAZIONI_URL, stationParams);
  if (!stationR.ok) return toToolResult(stationR);

  const stations = ((stationR.data as LombardiaStationRow[]) ?? []).map(parseStation);
  if (!stations.length) {
    return toToolResult({
      ok: false,
      url: stationR.url,
      status: 200,
      data: null,
      error: provincia ? `Nessuna stazione trovata in provincia ${provincia}` : "Nessuna stazione trovata",
      elapsedMs: Date.now() - 0,
    });
  }

  // Step 2: get recent readings for these sensor IDs
  // Socrata SODA doesn't support JOIN — we batch by $where on date+ID
  // Efficient: use $where with date filter and IN clause
  const maxMinuti = minuti ?? 120; // default last 2h
  const fromDate = new Date(Date.now() - maxMinuti * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "");

  // Socrata SoQL supports $where with IN
  const obsParams: Record<string, string> = {
    $where: `data >= '${fromDate}'`,
    $order: "data DESC",
    $limit: String(limit ?? 100),
  };

  const obsR = await apiGet(OSSERVAZIONI_URL, obsParams);
  if (!obsR.ok) return toToolResult(obsR);

  const obs = (obsR.data as ArpaLombardiaObs[]) ?? [];

  // Join with station info
  const stationMap = new Map(stations.map((s) => [s.idsensore, s]));
  const enriched = obs
    .filter((o) => stationMap.has(o.idsensore) && o.valore !== "-999")
    .map((o) => {
      const st = stationMap.get(o.idsensore)!;
      return {
        idsensore: o.idsensore,
        stazione: st.nomeStazione,
        provincia: st.provincia,
        tipologia: st.tipologia,
        unita: st.unitaMisura,
        data: o.data,
        valore: parseFloat(o.valore) || o.valore,
        stato: o.stato,
      };
    });

  return toToolResult({
    ...obsR,
    data: {
      fonte: "ARPA Lombardia (CC BY 4.0) — dati.lombardia.it",
      intervallo: `ultimi ${maxMinuti} minuti`,
      totale: enriched.length,
      osservazioni: enriched.slice(0, limit ?? 100),
      stazioniRiferimento: stations.map((s) => ({
        id: s.idsensore,
        nome: s.nomeStazione,
        provincia: s.provincia,
        tipologia: s.tipologia,
        quota: s.quota,
      })),
    },
  });
}

export function registerArpaLombardia(server: McpServer) {
  // --- ARPA Lombardia stazioni --------------------------------------------
  server.registerTool(
    "arpa_lombardia_stazioni",
    {
      title: "ARPA Lombardia Stazioni Meteorologiche",
      description:
        "Elenco delle stazioni idro-nivo-meteorologiche di ARPA Lombardia con coordinate, quota, provincia e tipologia sensori. Fonte: dati.lombardia.it (CC BY 4.0).",
      inputSchema: {
        provincia: z
          .string()
          .optional()
          .describe("Sigla provincia (BG, BS, CO, CR, LC, LO, MI, MN, PV, SO, VA). Omesso = tutte."),
        tipologia: z
          .string()
          .optional()
          .describe("Tipo sensore: Temperatura, Precipitazione, Vento, Umidita, etc. Omesso = tutti."),
        limit: z.coerce.number().int().min(1).max(2000).optional().describe("Max risultati (default: 200)"),
      },
      outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleArpaLombardiaStazioni,
  );

  // --- ARPA Lombardia osservazioni ----------------------------------------
  server.registerTool(
    "arpa_lombardia_osservazioni",
    {
      title: "ARPA Lombardia Osservazioni Meteo",
      description:
        "Ultime osservazioni orarie delle stazioni ARPA Lombardia (temperatura, precipitazione, vento, umidità, pressione, radiazione). I dati sono aggiornati in tempo reale dalla rete regionale. Filtra per provincia e tipo sensore.",
      inputSchema: {
        provincia: z.string().optional().describe("Sigla provincia (BG, BS, CO, CR, LC, LO, MI, MN, PV, SO, VA)."),
        tipologia: z
          .string()
          .optional()
          .describe(
            "Tipo sensore: Temperatura, Precipitazione, Vento, Livello Idrometrico, Umidita, etc. Omesso = tutte.",
          ),
        minuti: z.coerce
          .number()
          .int()
          .min(10)
          .max(1440)
          .optional()
          .describe("Intervallo in minuti per dati recenti (default: 120, max 1440 = 24h)"),
        limit: z.coerce.number().int().min(1).max(1000).optional().describe("Max risultati (default: 100)"),
      },
      outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleArpaLombardiaOsservazioni,
  );
}
