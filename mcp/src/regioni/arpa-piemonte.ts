import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiGet, toToolResult } from "../http.js";
import { haversine } from "../geo.js";

// ---------------------------------------------------------------------------
// ARPA Piemonte — stazioni meteorologiche e dati giornalieri
// https://utility.arpa.piemonte.it/meteoidro/ (Django REST framework)
// OpenAPI spec: https://utility.arpa.piemonte.it/schema/
// Licenza: CC BY 4.0
// ---------------------------------------------------------------------------

const API_BASE = "https://utility.arpa.piemonte.it";

export interface ArpaPiemonteStation {
  id: string;
  codice: string;
  denominazione: string;
  comune: string;
  provincia: string;
  lat: number;
  lon: number;
  quota: number;
  tipo: string;
  dataInizio: string;
  dataFine: string | null;
  puntoMisura: string;
}

/** Parse station from API response. */
export function parseStation(row: any): ArpaPiemonteStation {
  return {
    id: row.url ?? "",
    codice: row.codice_stazione ?? "",
    denominazione: row.denominazione ?? "",
    comune: row.comune ?? "",
    provincia: row.sigla_prov ?? "",
    lat: parseFloat(row.latitudine_n_wgs84_d) || 0,
    lon: parseFloat(row.longitudine_e_wgs84_d) || 0,
    quota: parseFloat(row.quota_stazione) || 0,
    tipo: row.tipo_staz ?? "",
    dataInizio: row.data_inizio ?? "",
    dataFine: row.data_fine ?? null,
    puntoMisura: row.fk_id_punto_misura_meteo ?? "",
  };
}

// --- Adapter per brief.ts (Piemonte) ----------------------------------------
export async function runBriefArpa(lat: number, lon: number): Promise<any> {
  const stazioniR = await apiGet(`${API_BASE}/meteoidro/stazione_meteorologica/`, { limit: 500, format: "json" });
  if (!stazioniR.ok) return { ok: false, agenzia: "ARPA Piemonte", error: stazioniR.error };
  const items: any[] = (stazioniR.data as any)?.results ?? [];
  let best: any = null;
  for (const s of items) {
    const slat = parseFloat(s.latitudine_n_wgs84_d) || 0;
    const slon = parseFloat(s.longitudine_e_wgs84_d) || 0;
    if (!slat || !slon) continue;
    const d = haversine({ lat, lon }, { lat: slat, lon: slon });
    if (!best || d < best.distKm) {
      best = {
        codice: s.codice_stazione,
        denominazione: s.denominazione,
        comune: s.comune,
        provincia: s.sigla_prov,
        lat: slat,
        lon: slon,
        quota: s.quota_stazione,
        puntoMisura: s.fk_id_punto_misura_meteo,
        distKm: Math.round(d * 10) / 10,
      };
    }
  }
  if (!best) return { ok: false, agenzia: "ARPA Piemonte", error: "nessuna stazione trovata" };

  // Fetch daily data for nearest station (ultimi 3 giorni)
  const puntoId = best.puntoMisura?.split("/").filter(Boolean).pop() ?? "";
  if (!puntoId) {
    return { ok: true, agenzia: "ARPA Piemonte (utility.arpa.piemonte.it)", stazioneVicina: best };
  }
  const today = new Date();
  const threeDaysAgo = new Date(today.getTime() - 3 * 86400000);
  const dataMin = threeDaysAgo.toISOString().slice(0, 10);
  const datiR = await apiGet(`${API_BASE}/meteoidro/dati_giornalieri_meteo/`, {
    fk_id_punto_misura_meteo: puntoId,
    data_min: dataMin,
    limit: 5,
    format: "json",
  });
  const dati = datiR.ok ? ((datiR.data as any)?.results ?? []) : [];

  return {
    ok: true,
    agenzia: "ARPA Piemonte (utility.arpa.piemonte.it)",
    stazioneVicina: {
      codice: best.codice,
      denominazione: best.denominazione,
      comune: best.comune,
      provincia: best.provincia,
      lat: best.lat,
      lon: best.lon,
      quota: best.quota,
      distKm: best.distKm,
    },
    osservazioni: dati.map((d: any) => ({
      data: d.data,
      tmedia: d.tmedia,
      tmax: d.tmax,
      tmin: d.tmin,
      ptot: d.ptot,
      umedia: d.umedia,
      vmedia: d.vmedia,
      vraffica: d.vraffica,
      rtot: d.rtot,
    })),
  };
}

export function registerArpaPiemonte(server: McpServer) {
  // --- ARPA Piemonte elenco stazioni ----------------------------------------
  server.registerTool(
    "arpa_piemonte_stazioni",
    {
      title: "ARPA Piemonte Stazioni Meteorologiche",
      description:
        "Elenco delle stazioni meteo della rete ARPA Piemonte (336 stazioni). Include denominazione, comune, provincia, coordinate WGS84, quota e tipo. Fonte: utility.arpa.piemonte.it (CC BY).",
      inputSchema: {
        provincia: z
          .string()
          .optional()
          .describe("Sigla provincia (TO, CN, NO, AL, AT, BI, VB, VC, VCO). Omesso = tutte."),
      },
      outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ provincia }) => {
      const r = await apiGet(`${API_BASE}/meteoidro/stazione_meteorologica/`, { limit: 500, format: "json" });
      if (!r.ok) return toToolResult(r);

      const rows = (r.data as any)?.results ?? [];
      let stations: ArpaPiemonteStation[] = rows.map(parseStation);
      if (provincia) {
        stations = stations.filter((s: ArpaPiemonteStation) => s.provincia === provincia.toUpperCase());
      }

      return toToolResult({
        ...r,
        data: {
          fonte: "ARPA Piemonte (CC BY) — utility.arpa.piemonte.it",
          totale: stations.length,
          stazioni: stations,
        },
      });
    },
  );
}
