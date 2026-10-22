/**
 * Log strutturato su stderr (stdout è riservato al trasporto MCP stdio).
 * Una riga JSON per evento; livello da METEO_MCP_LOG_LEVEL
 * (debug | info | warn | error | silent, default info).
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel | "silent", number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function threshold(): number {
  const raw = (process.env.METEO_MCP_LOG_LEVEL ?? "info").toLowerCase();
  return raw in ORDER ? ORDER[raw as LogLevel | "silent"] : ORDER.info;
}

function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < threshold()) return;
  process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }) + "\n");
}

/** Serializza un errore sconosciuto per i campi di log. */
export function errFields(err: unknown): Record<string, unknown> {
  return err instanceof Error ? { error: err.message } : { error: String(err) };
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};
