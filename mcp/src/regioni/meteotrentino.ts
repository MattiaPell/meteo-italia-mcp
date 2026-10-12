import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiGet, toToolResult } from "../http.js";
import { haversine } from "../geo.js";

const xmlParser = new XMLParser({
  isArray: (name, jpath) => {
    if (name === "anagrafica") return true;
    if (name === "temperatura_aria") return true;
    if (name === "precipitazione" && String(jpath).match(/\.precipitazioni?\.precipitazione$/)) return true;
    return false;
  },
});
// ---------------------------------------------------------------------------
// Meteotrentino (P.A. Trento)
// http://dati.meteotrentino.it/service.asmx/*
//   listaStazioni + ultimiDatiStazione?codice= (XML open data, CC BY).
// ---------------------------------------------------------------------------

export interface MeteoTrentinoStation {
  codice: string;
  nome: string;
  quota: number | null;
  lat: number;
  lon: number;
}

/** Parse the meteotrentino listaStazioni XML (active stations only). */
export function parseMeteoTrentinoStations(xml: string): MeteoTrentinoStation[] {
  const out: MeteoTrentinoStation[] = [];
  try {
    const parsed = xmlParser.parse(xml);
    const anagrafiche = parsed?.ArrayOfAnagrafica?.anagrafica || [];
    for (const b of anagrafiche) {
      if (b.fine && String(b.fine).trim() !== "") continue;

      const lat = parseFloat(b.latitudine);
      const lon = parseFloat(b.longitudine);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      out.push({
        codice: String(b.codice || "").trim(),
        nome: String(b.nomebreve || b.nome || "").trim(),
        quota: b.quota != null ? parseFloat(b.quota) : null,
        lat,
        lon,
      });
    }
  } catch (e) {
    console.error("Failed to parse MeteoTrentino stations XML", e);
  }
  return out;
}

export interface MeteoTrentinoObs {
  tmin: number | null;
  tmax: number | null;
  rainMm: number | null;
  lastTempC: number | null;
  lastTempAt: string | null;
  precipSumMm: number | null;
}

/** Parse ultimiDatiStazione XML (dati dalla mezzanotte del giorno precedente). */
export function parseMeteoTrentinoObs(xml: string): MeteoTrentinoObs {
  try {
    const parsed = xmlParser.parse(xml);
    const dati = parsed?.datiOggi || {};

    const tmin = dati.tmin != null ? parseFloat(dati.tmin) : null;
    const tmax = dati.tmax != null ? parseFloat(dati.tmax) : null;
    const rainMm = dati.rain != null ? parseFloat(dati.rain) : null;

    let lastTempC = null;
    let lastTempAt = null;
    if (dati.temperature?.temperatura_aria?.length > 0) {
      const temps = dati.temperature.temperatura_aria;
      const last = temps[temps.length - 1];
      if (last) {
        lastTempC = parseFloat(last.temperatura);
        lastTempAt = last.data;
      }
    }

    let precipSumMm = null;
    if (
      (dati.precipitazione?.precipitazione && dati.precipitazione.precipitazione.length > 0) ||
      (dati.precipitazioni?.precipitazione && dati.precipitazioni.precipitazione.length > 0)
    ) {
      const rains = dati.precipitazione?.precipitazione || dati.precipitazioni?.precipitazione;
      const sum = rains.reduce((a: number, p: any) => a + parseFloat(p.pioggia || 0), 0);
      precipSumMm = Math.round(sum * 10) / 10;
    }

    return {
      tmin: !Number.isNaN(tmin) ? tmin : null,
      tmax: !Number.isNaN(tmax) ? tmax : null,
      rainMm: !Number.isNaN(rainMm) ? rainMm : null,
      lastTempC: lastTempC != null && !Number.isNaN(lastTempC) ? lastTempC : null,
      lastTempAt: lastTempAt || null,
      precipSumMm: precipSumMm != null && !Number.isNaN(precipSumMm) ? precipSumMm : null,
    };
  } catch (e) {
    console.error("Failed to parse MeteoTrentino obs XML", e);
    return { tmin: null, tmax: null, rainMm: null, lastTempC: null, lastTempAt: null, precipSumMm: null };
  }
}

let cachedStations: MeteoTrentinoStation[] | null = null;
let cachedStationsTime = 0;

async function getStationsCached(): Promise<{ ok: boolean; error?: string; stations: MeteoTrentinoStation[] }> {
  if (cachedStations && Date.now() - cachedStationsTime < 3600000) {
    return { ok: true, stations: cachedStations };
  }
  const list = await apiGet("https://dati.meteotrentino.it/service.asmx/listaStazioni", {}, { acceptText: true });
  if (!list.ok) return { ok: false, error: list.error, stations: [] };
  cachedStations = parseMeteoTrentinoStations(String(list.data));
  cachedStationsTime = Date.now();
  return { ok: true, stations: cachedStations };
}

// --- Adapter per brief.ts (Trentino) ----------------------------------------
export async function runBriefArpa(lat: number, lon: number): Promise<any> {
  const list = await getStationsCached();
  if (!list.ok) return { ok: false, agenzia: "Meteotrentino", error: list.error };
  const stations = list.stations;
  let best: any = null;
  for (const s of stations) {
    const d = haversine({ lat, lon }, { lat: s.lat, lon: s.lon });
    if (!best || d < best.distKm) best = { ...s, distKm: Math.round(d * 10) / 10 };
  }
  if (!best) return { ok: false, agenzia: "Meteotrentino", error: "nessuna stazione" };
  const obs = await apiGet(
    `https://dati.meteotrentino.it/service.asmx/ultimiDatiStazione?codice=${best.codice}`,
    {},
    { acceptText: true },
  );
  return {
    ok: obs.ok,
    agenzia: "Meteotrentino (P.A. Trento)",
    stazione: { codice: best.codice, nome: best.nome, distKm: best.distKm, quota: best.quota },
    osservazioni: obs.ok ? parseMeteoTrentinoObs(String(obs.data)) : null,
  };
}

export function registerMeteotrentino(server: McpServer) {
  // --- Meteotrentino osservazioni (P.A. Trento) ---------------------------
  server.registerTool(
    "meteotrentino_osservazioni",
    {
      title: "Meteotrentino Osservazioni Stazioni",
      description:
        "Dati recenti (dalla mezzanotte di ieri) delle stazioni meteo del Trentino: tmin/tmax, pioggia cumulata, ultima temperatura. Seleziona la stazione per codice (es. T0383) o la più vicina a lat/lon. Fonte open data Provincia Autonoma di Trento (CC BY).",
      inputSchema: {
        codice: z
          .string()
          .optional()
          .describe("Codice stazione (es. T0383). Omesso = stazione attiva più vicina a lat/lon"),
        latitude: z.coerce.number().optional().describe("Lat per stazione più vicina"),
        longitude: z.coerce.number().optional().describe("Lon per stazione più vicina"),
      },
      outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ codice, latitude, longitude }) => {
      let stationCode = codice?.toUpperCase();
      let chosen: MeteoTrentinoStation | null = null;
      let distKm: number | null = null;
      if (!stationCode) {
        const list = await getStationsCached();
        if (!list.ok) {
          return toToolResult({
            ok: false,
            url: "https://dati.meteotrentino.it/service.asmx/listaStazioni",
            status: 500,
            data: null,
            error: list.error || "Errore sconosciuto",
            elapsedMs: 0,
          });
        }
        const stations = list.stations;
        if (latitude === undefined || longitude === undefined) {
          return toToolResult({
            ok: false,
            url: "https://dati.meteotrentino.it/service.asmx/listaStazioni",
            status: 200,
            data: null,
            error: "Passa codice stazione oppure latitude+longitude. Stazioni attive: " + stations.length,
            elapsedMs: 0,
          });
        }
        for (const s of stations) {
          const d = haversine({ lat: latitude, lon: longitude }, { lat: s.lat, lon: s.lon });
          if (distKm == null || d < distKm) {
            distKm = d;
            chosen = s;
          }
        }
        stationCode = chosen?.codice;
      }
      if (!stationCode) {
        return toToolResult({
          ok: false,
          url: "https://dati.meteotrentino.it/service.asmx/listaStazioni",
          status: 200,
          data: null,
          error: "Nessuna stazione trovata",
          elapsedMs: 0,
        });
      }
      const r = await apiGet(
        `https://dati.meteotrentino.it/service.asmx/ultimiDatiStazione?codice=${stationCode}`,
        {},
        { acceptText: true },
      );
      if (!r.ok) return toToolResult(r);
      const obs = parseMeteoTrentinoObs(String(r.data));
      return toToolResult({
        ...r,
        data: {
          fonte: "Meteotrentino / Provincia Autonoma di Trento (CC BY, dati non validati)",
          stazione: { codice: stationCode, nome: chosen?.nome ?? null, distKm },
          osservazioni: obs,
        },
      });
    },
  );
}
