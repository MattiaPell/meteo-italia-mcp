/** Risultato comune degli adapter ARPA richiamati da meteo_brief: `ok` più campi specifici dell'agenzia. */
export interface ArpaBriefResult {
  ok: boolean;
  agenzia?: string | null;
  [key: string]: unknown;
}
