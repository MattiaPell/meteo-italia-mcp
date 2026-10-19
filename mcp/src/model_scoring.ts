/**
 * Pesi dinamici: corregge i pesi statici per macroarea con l'errore recente
 * dei modelli sulla località (MAE della temperatura).
 */

export interface ModelSkill {
  model: string;
  /** Giorni con osservazione e previsione entrambe disponibili. */
  n: number;
  /** MAE medio di Tmax e Tmin, in °C. */
  mae: number;
}

export interface DynamicWeightOptions {
  /** Campioni minimi per considerare affidabile la skill di un modello. */
  minN?: number;
  /** Costante di shrinkage: con n = k la skill pesa al 50%. */
  k?: number;
  /** Limiti del fattore di correzione. */
  minFactor?: number;
  maxFactor?: number;
  /** MAE minimo usato nel rapporto, per non esplodere con errori quasi nulli. */
  maeFloor?: number;
}

export interface DynamicWeightResult {
  weights: Record<string, number>;
  /** Dettaglio per modello; `fattore` = 1 se la skill non è stata usata. */
  dettaglio: Array<{ modello: string; n: number; maeC: number; fattore: number }>;
  /** false se non c'erano abbastanza modelli con dati e si usano i pesi statici. */
  applicata: boolean;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * peso = statico × (1 + s × (f − 1)), con f = MAE di riferimento / MAE del modello
 * (limitato) e s = n / (n + k). Servono almeno due modelli con n ≥ minN per
 * avere un riferimento; altrimenti restano i pesi statici. I modelli senza
 * peso statico partono da 1.
 */
export function dynamicWeights(
  staticWeights: Record<string, number>,
  skills: ModelSkill[],
  opts: DynamicWeightOptions = {},
): DynamicWeightResult {
  const { minN = 5, k = 10, minFactor = 0.6, maxFactor = 1.5, maeFloor = 0.3 } = opts;
  const usable = skills.filter((s) => s.n >= minN && Number.isFinite(s.mae));
  if (usable.length < 2) {
    return { weights: { ...staticWeights }, dettaglio: [], applicata: false };
  }
  const ref = usable.reduce((a, s) => a + s.mae, 0) / usable.length;
  const weights: Record<string, number> = { ...staticWeights };
  const dettaglio: DynamicWeightResult["dettaglio"] = [];
  for (const s of usable) {
    const f = clamp(ref / Math.max(s.mae, maeFloor), minFactor, maxFactor);
    const shrink = s.n / (s.n + k);
    const factor = 1 + shrink * (f - 1);
    weights[s.model] = round2((staticWeights[s.model] ?? 1) * factor);
    dettaglio.push({ modello: s.model, n: s.n, maeC: round2(s.mae), fattore: round2(factor) });
  }
  return { weights, dettaglio, applicata: true };
}

interface VerificationStats {
  temperature_max?: { n: number; mae: number | null };
  temperature_min?: { n: number; mae: number | null };
}

/** Estrae la skill (MAE medio di Tmax/Tmin pesato sui campioni) dall'output di processModelVerification. */
export function skillsFromVerification(verification: Record<string, VerificationStats>): ModelSkill[] {
  const out: ModelSkill[] = [];
  for (const [model, v] of Object.entries(verification)) {
    const parts = [v.temperature_max, v.temperature_min].filter(
      (p): p is { n: number; mae: number } => !!p && p.n > 0 && p.mae != null,
    );
    const n = parts.reduce((a, p) => a + p.n, 0);
    if (!n) continue;
    const mae = parts.reduce((a, p) => a + p.mae * p.n, 0) / n;
    // n conta i giorni: ogni giorno contribuisce con Tmax e Tmin.
    out.push({ model, n: Math.min(...parts.map((p) => p.n)), mae });
  }
  return out;
}
