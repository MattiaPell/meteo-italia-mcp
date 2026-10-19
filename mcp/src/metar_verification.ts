import { apiGet } from "./http.js";
import { calculateStats } from "./verification.js";
import { ModelSkill } from "./model_scoring.js";

/**
 * Verifica oraria della temperatura prevista contro i METAR di una stazione:
 * il riferimento è un'osservazione reale nel punto, non una rianalisi.
 */

export interface MetarObs {
  /** Epoch in secondi (UTC). */
  time: number;
  tempC: number;
}

const HOUR_S = 3600;

/** Estrae (tempo, temperatura) dal JSON di aviationweather.gov; scarta i record incompleti. */
export function extractMetarObs(payload: unknown): MetarObs[] {
  const list = Array.isArray(payload) ? payload : ((payload as { data?: unknown } | null)?.data ?? []);
  if (!Array.isArray(list)) return [];
  const out: MetarObs[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const temp = rec.temp;
    let time: number | null = null;
    if (typeof rec.obsTime === "number") time = rec.obsTime;
    else if (typeof rec.reportTime === "string") {
      const ms = Date.parse(`${rec.reportTime.replace(" ", "T")}Z`);
      if (Number.isFinite(ms)) time = ms / 1000;
    }
    if (time != null && typeof temp === "number" && Number.isFinite(temp)) out.push({ time, tempC: temp });
  }
  return out;
}

/** Orario Open-Meteo "YYYY-MM-DDTHH:mm" (UTC) → epoch secondi. */
function parseUtc(t: string): number {
  return Date.parse(`${t}:00Z`) / 1000;
}

export interface MetarVerification {
  /** Per modello: statistiche sugli errori orari (previsione − osservazione). */
  perModello: Record<string, ReturnType<typeof calculateStats>>;
  /** Ore con osservazione e previsione in coppia (uguale per ogni modello con dati completi). */
  oreAccoppiate: number;
}

/**
 * Accoppia ogni osservazione con l'ora di previsione più vicina (±30 min; se
 * nella stessa ora ce ne sono più d'una vince la più vicina all'ora piena).
 */
export function verifyAgainstMetar(
  obs: MetarObs[],
  hourly: { time?: string[]; [key: string]: unknown },
  models: string[],
): MetarVerification {
  const times = hourly.time ?? [];
  const byHour = new Map<number, MetarObs>();
  for (const o of obs) {
    const hour = Math.round(o.time / HOUR_S) * HOUR_S;
    const dist = Math.abs(o.time - hour);
    const prev = byHour.get(hour);
    if (!prev || dist < Math.abs(prev.time - hour)) byHour.set(hour, o);
  }
  const idxByHour = new Map<number, number>();
  times.forEach((t, i) => idxByHour.set(parseUtc(t), i));

  const perModello: MetarVerification["perModello"] = {};
  let ore = 0;
  for (const model of models) {
    const series = hourly[`temperature_2m_${model}`] ?? (models.length === 1 ? hourly.temperature_2m : undefined);
    const errs: number[] = [];
    if (Array.isArray(series)) {
      for (const [hour, o] of byHour) {
        const i = idxByHour.get(hour);
        const f = i === undefined ? undefined : series[i];
        if (typeof f === "number" && Number.isFinite(f)) errs.push(f - o.tempC);
      }
    }
    perModello[model] = calculateStats(errs);
    ore = Math.max(ore, errs.length);
  }
  return { perModello, oreAccoppiate: ore };
}

/** Skill per `dynamicWeights`: n è in giorni equivalenti (ore/24), perché le ore consecutive sono molto correlate. */
export function skillsFromMetar(v: MetarVerification): ModelSkill[] {
  const out: ModelSkill[] = [];
  for (const [model, s] of Object.entries(v.perModello)) {
    if (s.n > 0 && s.mae != null) out.push({ model, n: Math.floor(s.n / 24), mae: s.mae });
  }
  return out;
}

/** Scarica METAR recenti della stazione e la previsione oraria nello stesso punto. */
export async function fetchMetarVerification(
  station: { icao: string; lat: number; lon: number },
  models: string[],
  days: number,
): Promise<MetarVerification | null> {
  const [metarRes, fcRes] = await Promise.all([
    apiGet("https://aviationweather.gov/api/data/metar", { ids: station.icao, format: "json", hours: days * 24 }),
    apiGet("https://api.open-meteo.com/v1/forecast", {
      latitude: station.lat,
      longitude: station.lon,
      models,
      hourly: ["temperature_2m"],
      past_days: days,
      forecast_days: 1,
      timezone: "UTC",
    }),
  ]);
  if (!metarRes.ok || !fcRes.ok) return null;
  const hourly = (fcRes.data as { hourly?: { time?: string[] } } | null)?.hourly;
  if (!hourly) return null;
  return verifyAgainstMetar(extractMetarObs(metarRes.data), hourly, models);
}
