import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiGet, toToolResult, latLon } from "./http.js";
import { round1 } from "./models.js";

export function calculateStats(errs: number[]) {
  if (!errs.length) return { n: 0, mae: null, bias: null, rmse: null };
  const n = errs.length;
  const mae = round1(errs.reduce((s, e) => s + Math.abs(e), 0) / n);
  const bias = round1(errs.reduce((s, e) => s + e, 0) / n);
  const rmse = round1(Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / n));
  return { n, mae, bias, rmse };
}

export async function fetchVerificationData(latitude: number, longitude: number, days: number, modelList: string[]) {
  const forecastRes = await apiGet("https://api.open-meteo.com/v1/forecast", {
    latitude,
    longitude,
    models: modelList,
    daily: ["temperature_2m_max", "temperature_2m_min", "precipitation_sum"],
    past_days: days,
    forecast_days: 0,
    timezone: "Europe/Rome",
  });

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const archiveRes = await apiGet("https://archive-api.open-meteo.com/v1/archive", {
    latitude,
    longitude,
    daily: ["temperature_2m_max", "temperature_2m_min", "precipitation_sum"],
    start_date: fmt(startDate),
    end_date: fmt(endDate),
    timezone: "Europe/Rome",
  });

  return { forecastRes, archiveRes };
}

type Series = Array<number | null>;
export type DailyBag = { daily?: Record<string, unknown> } | null | undefined;

export interface ModelVerification {
  temperature_max: ReturnType<typeof calculateStats>;
  temperature_min: ReturnType<typeof calculateStats>;
  precipitation: ReturnType<typeof calculateStats>;
  daily: Array<{
    date: string;
    era5: { tmax: number | null; tmin: number | null; precip: number | null };
    forecast: { tmax: number | null; tmin: number | null; precip: number | null };
    error: { tmax: number | null; tmin: number | null; precip: number | null };
  }>;
}

/** Serie daily per chiave; prova prima la chiave per modello poi quella senza suffisso. */
function dailySeries(d: DailyBag, ...keys: string[]): Series {
  for (const k of keys) {
    const v = d?.daily?.[k];
    if (Array.isArray(v)) return v as Series;
  }
  return [];
}

const diff = (a: number | null | undefined, b: number | null | undefined): number | null =>
  a != null && b != null ? round1(a - b) : null;

export function processModelVerification(modelList: string[], fData: DailyBag, aData: DailyBag) {
  const era5Dates = dailySeries(aData, "time") as unknown as string[];
  const era5Tmax = dailySeries(aData, "temperature_2m_max");
  const era5Tmin = dailySeries(aData, "temperature_2m_min");
  const era5Precip = dailySeries(aData, "precipitation_sum");

  const verification: Record<string, ModelVerification> = {};
  for (const model of modelList) {
    const fTmax = dailySeries(fData, `temperature_2m_max_${model}`, "temperature_2m_max");
    const fTmin = dailySeries(fData, `temperature_2m_min_${model}`, "temperature_2m_min");
    const fPrecip = dailySeries(fData, `precipitation_sum_${model}`, "precipitation_sum");
    const fDates = dailySeries(fData, "time") as unknown as string[];

    const errors = { tmax: [] as number[], tmin: [] as number[], precip: [] as number[] };
    const dailyComparison: ModelVerification["daily"] = [];

    const fDatesIndex = new Map<string, number>();
    for (let i = 0; i < fDates.length; i++) {
      if (!fDatesIndex.has(fDates[i])) {
        fDatesIndex.set(fDates[i], i);
      }
    }

    for (let i = 0; i < era5Dates.length; i++) {
      const fi = fDatesIndex.get(era5Dates[i]);
      if (fi === undefined) continue;
      const eTmax = era5Tmax[i],
        eTmin = era5Tmin[i],
        eP = era5Precip[i];
      const fTmaxV = fTmax[fi],
        fTminV = fTmin[fi],
        fPV = fPrecip[fi];
      if (eTmax != null && fTmaxV != null) errors.tmax.push(fTmaxV - eTmax);
      if (eTmin != null && fTminV != null) errors.tmin.push(fTminV - eTmin);
      if (eP != null && fPV != null) errors.precip.push(fPV - eP);
      dailyComparison.push({
        date: era5Dates[i],
        era5: { tmax: eTmax, tmin: eTmin, precip: eP },
        forecast: { tmax: fTmaxV, tmin: fTminV, precip: fPV },
        error: { tmax: diff(fTmaxV, eTmax), tmin: diff(fTminV, eTmin), precip: diff(fPV, eP) },
      });
    }

    verification[model] = {
      temperature_max: calculateStats(errors.tmax),
      temperature_min: calculateStats(errors.tmin),
      precipitation: calculateStats(errors.precip),
      daily: dailyComparison,
    };
  }

  return { verification, era5Dates };
}

export async function handleMeteoVerification({
  latitude,
  longitude,
  days,
  models,
}: {
  latitude: number;
  longitude: number;
  days: number;
  models: string;
}) {
  const start = Date.now();
  const modelList = models
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  const { forecastRes, archiveRes } = await fetchVerificationData(latitude, longitude, days, modelList);

  if (!forecastRes.ok || !archiveRes.ok) {
    return toToolResult({
      ok: false,
      url: "mcp://verification",
      status: 0,
      data: null,
      error: `Dati non disponibili: forecast=${forecastRes.ok}, archive=${archiveRes.ok}`,
      elapsedMs: Date.now() - start,
    });
  }

  const { verification, era5Dates } = processModelVerification(
    modelList,
    forecastRes.data as DailyBag,
    archiveRes.data as DailyBag,
  );

  return toToolResult({
    ok: true,
    url: "mcp://verification",
    status: 200,
    data: {
      location: { latitude, longitude },
      period: { from: era5Dates[0], to: era5Dates[era5Dates.length - 1], days: era5Dates.length },
      reference: "ERA5 Reanalysis (ECMWF)",
      verification,
      interpretation:
        "bias>0=model sovrastima, bias<0=model sottostima. MAE=errore medio assoluto. RMSE=punisce errori grandi. Le previsioni confrontate sono la serie recente a breve scadenza (non lead time fissi); il riferimento ERA5 è una rianalisi, debole per la precipitazione.",
    },
    elapsedMs: Date.now() - start,
  });
}

// --- 7. HISTORICAL VERIFICATION TOOL ----------------------------------------
export function registerVerification(server: McpServer) {
  server.registerTool(
    "meteo_verification",
    {
      title: "Historical Forecast Verification",
      description:
        "Confronta le previsioni recenti dei modelli (serie degli ultimi giorni a breve scadenza, non emissioni a lead time fisso) con la rianalisi ERA5 e calcola MAE, bias e RMSE per temperatura e precipitazione. Misura il bias locale recente, non l'affidabilità a 3-7 giorni. ERA5 ha ~5 giorni di ritardo e per la precipitazione è un riferimento debole.",
      inputSchema: {
        ...latLon,
        days: z.coerce.number().int().min(3).max(30).default(7).describe("Number of past days to verify (3-30)"),
        models: z.string().default("ecmwf_ifs025").describe("Comma-separated model ids to verify"),
      },
      outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    handleMeteoVerification,
  );
}
