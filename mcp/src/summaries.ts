import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiGet, toToolResult, openMeteoCommon, latLon, ApiResult } from "./http.js";
import { normalizeModelId } from "./models.js";

/**
 * Compute a compact per-model summary from a raw Open-Meteo forecast/ensemble
 * response. Open-Meteo suffixes every variable with `_<model>` when several
 * models are requested, so we detect variables by suffix, not exact name.
 *
 * The result is ~90% smaller than the raw payload and is what the skill's
 * report actually needs (daily extremes, totals, event-hour counts).
 */
type SeriesBag = Record<string, unknown>;

/** Forma minima della risposta Open-Meteo letta da summarizeForecast. */
export interface OpenMeteoRaw {
  latitude?: number;
  longitude?: number;
  elevation?: number;
  timezone?: string;
  daily?: SeriesBag;
  hourly?: SeriesBag;
}

export interface ModelDaySummary {
  temp_max?: number;
  temp_min?: number;
  precip_sum?: number;
  precip_prob_max?: number;
  cape_max?: number;
  gust_max?: number;
  precip_hours: number;
  thunderstorm_hours: number;
}

export interface DaySummary {
  date: string;
  models: Record<string, ModelDaySummary>;
  score: number;
  flags: string[];
}

export interface ForecastSummary {
  location: { latitude?: number; longitude?: number; elevation?: number; timezone: string };
  days: DaySummary[];
}

export function summarizeForecast(raw: OpenMeteoRaw | null | undefined, models?: string[]): ForecastSummary {
  const daily = raw?.daily;
  const hourly = raw?.hourly;
  const dates: string[] = (daily?.time as string[]) ?? [];

  // Open-Meteo appends `_<model>` to every variable when multiple models are
  // requested. Model ids contain underscores (e.g. ecmwf_ifs025), so we match
  // the known model ids against the end of each key instead of naive splitting.
  const modelList = (models && models.length ? models : inferModels(daily, hourly)).map(normalizeModelId);

  const pickDaily = (model: string, base: string): number[] | undefined => {
    const arr =
      (daily?.[`${base}_${model}`] as number[]) ?? (modelList.length === 1 ? (daily?.[base] as number[]) : undefined);
    return Array.isArray(arr) ? arr : undefined;
  };
  const pickHourly = (model: string, base: string): number[] | undefined => {
    const arr =
      (hourly?.[`${base}_${model}`] as number[]) ?? (modelList.length === 1 ? (hourly?.[base] as number[]) : undefined);
    return Array.isArray(arr) ? arr : undefined;
  };

  // Indici orari [start, end) per data: l'array hourly è ordinato, quindi le
  // ore di un giorno sono contigue. Serve per massimi giornalieri da hourly.
  const hourRange = new Map<string, [number, number]>();
  const hourTimes = (hourly?.time as string[]) ?? [];
  for (let h = 0; h < hourTimes.length; h++) {
    const d = hourTimes[h]?.slice(0, 10);
    if (!d) continue;
    const r = hourRange.get(d);
    if (r) r[1] = h + 1;
    else hourRange.set(d, [h, h + 1]);
  }
  const hourlyDayMax = (model: string, base: string, date: string): number | undefined => {
    const arr = pickHourly(model, base);
    const r = hourRange.get(date);
    if (!arr || !r) return undefined;
    const xs = arr.slice(r[0], r[1]).filter((v): v is number => v != null);
    return xs.length ? Math.max(...xs) : undefined;
  };

  const days = dates.map((date, i) => {
    const modelsOut: Record<string, ModelDaySummary> = {};
    for (const s of modelList) {
      const tmax = pickDaily(s, "temperature_2m_max")?.[i];
      const tmin = pickDaily(s, "temperature_2m_min")?.[i];
      const psum = pickDaily(s, "precipitation_sum")?.[i];
      const pprob = pickDaily(s, "precipitation_probability_max")?.[i];
      // CAPE: only available as hourly, not daily — compute the max of that day's hours
      const cape = hourlyDayMax(s, "cape", date);
      const gust = pickDaily(s, "wind_gusts_10m_max")?.[i] ?? hourlyDayMax(s, "wind_gusts_10m", date);
      modelsOut[s] = {
        temp_max: num(tmax),
        temp_min: num(tmin),
        precip_sum: num(psum),
        precip_prob_max: num(pprob),
        cape_max: num(cape),
        gust_max: num(gust),
        precip_hours: 0,
        thunderstorm_hours: 0,
      };
    }
    return { date, models: modelsOut };
  });

  // Score 0-100 (100 = condizioni ideali). Penalizza pioggia, temporali,
  // vento forte e caldo/freddo estremo. Calcolato per giorno su media modelli.
  const scoreDay = (d: { models: Record<string, ModelDaySummary> }): { score: number; flags: string[] } => {
    const vals = Object.values(d.models);
    if (!vals.length) return { score: 50, flags: [] };
    const avg = (sel: (m: ModelDaySummary) => number | undefined) => {
      const xs = vals.map(sel).filter((v): v is number => v != null);
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
    };
    const psum = avg((m) => m.precip_sum);
    const pprob = avg((m) => m.precip_prob_max);
    const gust = avg((m) => m.gust_max);
    const cape = avg((m) => m.cape_max);
    const tmax = avg((m) => m.temp_max);
    const tmin = avg((m) => m.temp_min);
    const thun = Math.max(...vals.map((m) => m.thunderstorm_hours ?? 0));
    let score = 100;
    const flags: string[] = [];
    if (psum != null && psum > 0) {
      score -= Math.min(40, psum * 4);
      if (psum >= 10) flags.push("pioggia_forte");
    }
    if (pprob != null && pprob > 50) score -= (pprob - 50) * 0.3;
    if (gust != null && gust > 40) {
      score -= Math.min(25, (gust - 40) * 0.6);
      if (gust >= 70) flags.push("vento_forte");
    }
    if (thun > 0) {
      score -= Math.min(25, thun * 2);
      flags.push("temporale");
    }
    if (cape != null && cape > 800) flags.push("instabile");
    if (tmax != null && tmax >= 34) {
      score -= (tmax - 34) * 2;
      flags.push("caldo_estremo");
    }
    if (tmin != null && tmin <= 0) {
      score -= Math.min(15, (0 - tmin) * 1.5);
      if (tmin <= -5) flags.push("gelo");
    }
    score = Math.max(0, Math.min(100, Math.round(score)));
    return { score, flags };
  };

  // Hourly event counts (per model, over the whole window).
  if (hourly?.time) {
    const times = hourly.time as string[];
    const n = times.length;
    // Pre-build time→dayIndex map to avoid O(n*m) findIndex per hour.
    const timeToDayIdx = new Map<string, number>();
    const dateToIdx = new Map<string, number>();
    for (let di = 0; di < dates.length; di++) {
      dateToIdx.set(dates[di], di);
    }
    for (const t of times) {
      if (!t) continue;
      const d = t.slice(0, 10);
      const idx = dateToIdx.get(d);
      if (idx !== undefined) {
        timeToDayIdx.set(t, idx);
      }
    }
    for (const s of modelList) {
      const wc = pickHourly(s, "weather_code");
      const precip = pickHourly(s, "precipitation");
      if (!wc) continue;
      for (let i = 0; i < n; i++) {
        const code = num(wc[i]);
        const p = num(precip?.[i]);
        const dayIdx = timeToDayIdx.get(times[i]) ?? -1;
        if (dayIdx < 0) continue;
        const m = days[dayIdx]?.models[s];
        if (!m) continue;
        if (p !== null && p !== undefined && p > 0) m.precip_hours++;
        if (code !== null && code !== undefined && code >= 95 && code <= 99) m.thunderstorm_hours++;
      }
    }
  }

  const scoredDays = days.map((d) => {
    const { score, flags } = scoreDay(d);
    return { ...d, score, flags };
  });

  return {
    location: {
      latitude: raw?.latitude,
      longitude: raw?.longitude,
      elevation: raw?.elevation,
      timezone: raw?.timezone ?? "unknown",
    },
    days: scoredDays,
  };
}

/** Best-effort model discovery when the caller didn't pass the list.
 *
 * Open-Meteo suffixes every variable with `_<model>` when multiple models are
 * requested. Model ids contain underscores (e.g. `ecmwf_ifs025`), so we
 * normalize keys and match exact id or `_<id>` suffix against a canonical list.
 */
const KNOWN_MODELS = new Set([
  // `ecmwf_ifs` escluso: Open-Meteo usa `ecmwf_ifs025`.
  "ecmwf_ifs025",
  "ecmwf_ifs025_ensemble_mean",
  "ecmwf_aifs025",
  "icon_seamless",
  "icon_global",
  "icon_eu",
  "icon_d2",
  "italia_meteo_arpae_icon_2i",
  "meteofrance_seamless",
  "arpege_europe",
  "arome_france",
  "gfs_seamless",
  "gfs025",
  "gfs025_ensemble_mean",
  "gfs_graphcast025",
  "gem_seamless",
  "jma_seamless",
  "meteoswiss_icon_seamless",
  "geosphere_seamless",
  "knmi_seamless",
  "metno_nve",
  "ukmo_seamless",
  "ukmo_ukdeterministic_2km",
]);

export function inferModels(daily?: SeriesBag, hourly?: SeriesBag): string[] {
  const found = new Set<string>();
  const scan = (obj?: SeriesBag) => {
    if (!obj || typeof obj !== "object") return;
    for (const rawKey of Object.keys(obj)) {
      if (rawKey === "time") continue;
      const key = normalizeModelId(rawKey);
      // Matcha il modello col suffisso più lungo (evita falsi match:
      // key ending _meteoswiss_icon_seamless matcherebbe _icon_seamless).
      let bestMatch: string | null = null;
      for (const model of KNOWN_MODELS) {
        const norm = normalizeModelId(model);
        if (key === norm || key.endsWith(`_${norm}`)) {
          if (!bestMatch || norm.length > bestMatch.length) {
            bestMatch = norm;
          }
        }
      }
      if (bestMatch) found.add(bestMatch);
    }
  };
  scan(daily);
  scan(hourly);
  return [...found];
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && !Number.isNaN(v) ? v : undefined;
}

export function registerSummaries(server: McpServer) {
  server.registerTool(
    "open_meteo_forecast_summary",
    {
      title: "Open-Meteo Forecast Summary (compact)",
      description:
        "Same call as open_meteo_forecast but returns a COMPACT per-model daily summary (temp max/min, precip sum, precip-prob max, CAPE max, gust max, thunderstorm/precip hour counts) instead of the full hourly grid. Use this instead of the raw forecast to save ~90% context when you only need the report-level numbers. Raw hourly stays available via open_meteo_forecast for Level 2/3 deep dives.",
      inputSchema: {
        ...latLon,
        ...openMeteoCommon,
        models: z
          .string()
          .optional()
          .describe("Comma-separated model list, e.g. ecmwf_ifs025,icon_seamless,gfs_seamless"),
        hourly: z
          .string()
          .optional()
          .describe("Comma-separated hourly variables (need weather_code + precipitation for event counts)"),
        daily: z.string().optional().describe("Comma-separated daily variables"),
        current: z.string().optional().describe("Comma-separated current variables"),
      },
      outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ latitude, longitude, models, hourly, daily, current, timezone, past_days, forecast_days }) => {
      const raw = await apiGet("https://api.open-meteo.com/v1/forecast", {
        latitude,
        longitude,
        models: models
          ? models
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean)
          : undefined,
        hourly: hourly
          ? hourly
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean)
          : ["temperature_2m", "precipitation", "weather_code", "cape", "wind_gusts_10m"],
        daily: daily
          ? daily
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean)
          : ["temperature_2m_max", "temperature_2m_min", "precipitation_sum", "precipitation_probability_max"],
        current: current
          ? current
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean)
          : undefined,
        timezone,
        past_days,
        forecast_days,
      });
      if (!raw.ok) return toToolResult(raw);
      const modelList = models
        ? models
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
            .map(normalizeModelId)
        : undefined;
      const summary = summarizeForecast(raw.data as OpenMeteoRaw, modelList);
      const result: ApiResult = { ...raw, data: summary };
      return toToolResult(result);
    },
  );
}
