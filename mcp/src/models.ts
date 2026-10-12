/** Helper condivisi per i moduli dei tool di riferimento.
 *  Modulo foglia (nessuna dipendenza interna): summaries.ts e i tool di
 *  riferimento possono importarlo senza dipendenze circolari. */

/** Unifica dash/underscore negli id modello: `icon-eu` e `icon_eu` matchano. */
export function normalizeModelId(id: string): string {
  const lower = id.trim().toLowerCase().replace(/-/g, "_");
  if (lower === "icon" || lower === "icon_d2") return "icon_d2";
  return lower;
}

/** Arrotonda a 1 decimale preservando null. Condiviso dai tool di verifica. */
export function round1(v: number | null): number | null {
  return v == null ? null : Math.round(v * 10) / 10;
}
