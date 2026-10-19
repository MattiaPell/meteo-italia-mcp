/**
 * Probabilità giornaliere da un ensemble Open-Meteo.
 *
 * L'ensemble API restituisce un array orario per ogni membro: la variabile
 * base è il controllo, `<base>_memberNN` (con eventuale suffisso `_<modello>`)
 * i perturbati. Le probabilità sono la frazione di membri che supera la soglia.
 */

export interface EnsembleHourly {
  time?: string[];
  [key: string]: unknown;
}

export interface ProbabilitaGiorno {
  data: string;
  /** P(precipitazione giornaliera ≥ 1 mm), in %. */
  pPioggia1mm: number | null;
  /** P(precipitazione giornaliera ≥ 10 mm), in %. */
  pPioggia10mm: number | null;
  /** P(temperatura minima ≤ 0 °C), in %. */
  pGelo: number | null;
  /** P(temperatura massima ≥ 35 °C), in %. */
  pCaldoEstremo: number | null;
  /** P(raffica massima ≥ 60 km/h), in %. */
  pRaffica60: number | null;
}

export interface EnsembleSummary {
  membri: number;
  tempSpreadMaxC: number | null;
  precipMeanTotMm: number | null;
  precipSpreadMaxMm: number | null;
  probabilita: ProbabilitaGiorno[];
}

export const ENSEMBLE_THRESHOLDS = { pioggia1mm: 1, pioggia10mm: 10, gelo: 0, caldo: 35, raffica: 60 };

/** Serie orarie di tutti i membri (controllo incluso) per la variabile `base`. */
export function memberSeries(hourly: EnsembleHourly, base: string): number[][] {
  const series: number[][] = [];
  for (const [key, val] of Object.entries(hourly)) {
    if (!Array.isArray(val)) continue;
    const isMember = key.startsWith(`${base}_member`);
    const isControl = key === base || key === `${base}_control`;
    if (isMember || isControl) series.push(val.map((v) => (typeof v === "number" ? v : NaN)));
  }
  return series;
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const pct = (hits: number, n: number) => (n > 0 ? Math.round((hits / n) * 100) : null);
const finite = (xs: number[]) => xs.filter((x) => Number.isFinite(x));

function std(xs: number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

/** Estremi di indice [start, end) per ogni data (le ore di un giorno sono contigue). */
function dayRanges(times: string[]): Array<{ date: string; start: number; end: number }> {
  const out: Array<{ date: string; start: number; end: number }> = [];
  for (let i = 0; i < times.length; i++) {
    const date = times[i]?.slice(0, 10);
    if (!date) continue;
    const last = out[out.length - 1];
    if (last && last.date === date) last.end = i + 1;
    else out.push({ date, start: i, end: i + 1 });
  }
  return out;
}

/** Riassume l'ensemble; ritorna null se non ci sono serie di membri utilizzabili. */
export function summarizeEnsemble(hourly: EnsembleHourly): EnsembleSummary | null {
  const times = hourly.time ?? [];
  const temp = memberSeries(hourly, "temperature_2m");
  const prec = memberSeries(hourly, "precipitation");
  const gust = memberSeries(hourly, "wind_gusts_10m");
  const membri = Math.max(temp.length, prec.length, gust.length);
  if (!times.length || membri < 2) return null;

  // Statistiche orarie sui membri: media/spread (deviazione standard).
  const hourStat = (series: number[][], h: number) => {
    const vals = finite(series.map((s) => s[h]));
    return vals.length > 1 ? { mean: vals.reduce((a, b) => a + b, 0) / vals.length, sd: std(vals) } : null;
  };
  const tSd: number[] = [];
  const pSd: number[] = [];
  let pMeanTot = 0;
  let pHours = 0;
  for (let h = 0; h < times.length; h++) {
    const t = hourStat(temp, h);
    if (t) tSd.push(t.sd);
    const p = hourStat(prec, h);
    if (p) {
      pSd.push(p.sd);
      pMeanTot += p.mean;
      pHours++;
    }
  }

  const probabilita: ProbabilitaGiorno[] = dayRanges(times).map(({ date, start, end }) => {
    const per = (series: number[][], agg: (xs: number[]) => number): number[] =>
      series
        .map((s) => finite(s.slice(start, end)))
        .filter((xs) => xs.length > 0)
        .map(agg);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const dayPrec = per(prec, sum);
    const dayTmin = per(temp, (xs) => Math.min(...xs));
    const dayTmax = per(temp, (xs) => Math.max(...xs));
    const dayGust = per(gust, (xs) => Math.max(...xs));
    const share = (xs: number[], pred: (x: number) => boolean) => pct(xs.filter(pred).length, xs.length);
    return {
      data: date,
      pPioggia1mm: share(dayPrec, (x) => x >= ENSEMBLE_THRESHOLDS.pioggia1mm),
      pPioggia10mm: share(dayPrec, (x) => x >= ENSEMBLE_THRESHOLDS.pioggia10mm),
      pGelo: share(dayTmin, (x) => x <= ENSEMBLE_THRESHOLDS.gelo),
      pCaldoEstremo: share(dayTmax, (x) => x >= ENSEMBLE_THRESHOLDS.caldo),
      pRaffica60: share(dayGust, (x) => x >= ENSEMBLE_THRESHOLDS.raffica),
    };
  });

  return {
    membri,
    tempSpreadMaxC: tSd.length ? round1(Math.max(...tSd)) : null,
    precipMeanTotMm: pHours ? round1(pMeanTot) : null,
    precipSpreadMaxMm: pSd.length ? round1(Math.max(...pSd)) : null,
    probabilita,
  };
}
