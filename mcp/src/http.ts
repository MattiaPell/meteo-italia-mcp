import { z } from "zod";
import { MeteoError } from "./errors.js";

export const DEBUG_PORT = Number(process.env.METEO_MCP_DEBUG_PORT ?? 3000);
export const CHECKWX_API_KEY = process.env.CHECKWX_API_KEY;

/** Default per-request timeout (ms). Oltre 10s la fonte è considerata non disponibile. */
export const HTTP_TIMEOUT_MS = 10_000;
/** Max retry attempts after a timeout/5xx/429 (excludes the first try). */
export const HTTP_MAX_RETRIES = 2;
/** Base backoff (ms) for exponential retry. */
export const HTTP_BACKOFF_BASE_MS = 500;

const CACHE_TTL_MS: Record<string, number> = {
  "geocoding-api.open-meteo.com": 3_600_000,
  "api.open-meteo.com": 300_000,
  "archive-api.open-meteo.com": 3_600_000,
  "marine-api.open-meteo.com": 300_000,
  "air-quality-api.open-meteo.com": 300_000,
  "ensemble-api.open-meteo.com": 300_000,
  // Radar-DPC products update every 5 min — keep the discovery call fresh.
  "radar-api.protezionecivile.it": 120_000,
  // DPC bulletins are published ~daily (plus evening updates).
  "api.github.com": 1_800_000,
  "raw.githubusercontent.com": 1_800_000,
  // ARPA regional observations update every 10-30 min.
  "api.arpa.veneto.it": 300_000,
  "www.arpa.veneto.it": 300_000,
  "dati.meteotrentino.it": 300_000,
  "apimeteo.regione.marche.it": 300_000,
  "www.dati.lombardia.it": 300_000,
  "www.floods.it": 300_000,
  "aviationweather.gov": 120_000,
  "api.checkwx.com": 120_000,
};

export interface ApiResult {
  [key: string]: unknown;
  ok: boolean;
  url: string;
  status: number;
  /** Parsed JSON when available, otherwise raw text. */
  data: unknown;
  error?: string;
  /** Timing in ms, useful for the debug page. */
  elapsedMs: number;
  cached?: boolean;
}

export interface RequestMetrics {
  hits: number;
  misses: number;
  errors: number;
  latenciesMs: number[];
}

const metrics: Record<string, RequestMetrics> = {};
function recordMetrics(host: string, ok: boolean, elapsedMs: number) {
  if (!(host in metrics)) {
    metrics[host] = { hits: 0, misses: 0, errors: 0, latenciesMs: [] };
  }
  const m = metrics[host];
  m.latenciesMs.push(elapsedMs);
  if (m.latenciesMs.length > 100) m.latenciesMs.shift();
  if (ok) m.hits += 1;
  else m.errors += 1;
}
export function getMetrics(): Record<string, RequestMetrics> {
  return metrics;
}
export function getCacheStats(): { hits: number; misses: number } {
  return { hits: cacheHits, misses: cacheMisses };
}

interface CacheEntry {
  result: ApiResult;
  expires: number;
}
const cache = new Map<string, CacheEntry>();
/** Max entries in the response cache; oldest are evicted first. */
export const CACHE_MAX_ENTRIES = 500;

function cacheStore(url: string, result: ApiResult): void {
  const key = cacheKey(url);
  cache.delete(key);
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (v.expires <= now) cache.delete(k);
    }
    while (cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
  cache.set(key, { result, expires: Date.now() + cacheTtlFor(url) });
}
export function getCacheSize(): number {
  return cache.size;
}
let cacheHits = 0;
let cacheMisses = 0;

function cacheKey(url: string): string {
  return url;
}
function cacheTtlFor(url: string): number {
  try {
    const host = new URL(url).host;
    return CACHE_TTL_MS[host] ?? 60_000;
  } catch {
    return 60_000;
  }
}

type RetriableOpts = {
  headers?: Record<string, string>;
  acceptText?: boolean;
  method?: "GET" | "POST";
  body?: string;
  noCache?: boolean;
};

function getHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}

function getCachedResponse(url: string, host: string, opts: RetriableOpts): ApiResult | undefined {
  if (opts.method === "POST" || opts.noCache) return undefined;

  const hit = cache.get(cacheKey(url));
  if (hit && hit.expires > Date.now()) {
    cacheHits += 1;
    if (!(host in metrics)) {
      metrics[host] = { hits: 0, misses: 0, errors: 0, latenciesMs: [] };
    }
    metrics[host].hits += 1;
    return { ...hit.result, cached: true };
  }
  cacheMisses += 1;
  return undefined;
}

function buildFetchOptions(opts: RetriableOpts, signal: AbortSignal): RequestInit {
  return {
    method: opts.method ?? "GET",
    headers: {
      "User-Agent": "meteo-italia-mcp/1.0",
      Accept: opts.acceptText ? "text/plain, */*" : "application/json, */*",
      ...(opts.method === "POST" ? { "Content-Type": "application/json" } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.body,
    signal,
  };
}

function parsePayload(text: string, acceptText?: boolean): unknown {
  if (acceptText) return text;
  try {
    return text.length ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

function calculateBackoff(res: Response | undefined, attempt: number): number {
  if (res?.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      return retryAfter * 1000;
    }
  }
  return HTTP_BACKOFF_BASE_MS * 2 ** attempt;
}

function formatNetworkError(err: unknown, url: string): MeteoError {
  const isAbort = err instanceof Error && err.name === "AbortError";
  const code = isAbort ? "TIMEOUT" : "NETWORK";
  const message = isAbort
    ? `Request to ${url} timed out after ${HTTP_TIMEOUT_MS}ms`
    : `Network error contacting ${url}: ${err instanceof Error ? err.message : String(err)}`;
  return new MeteoError(code, message, err);
}

/**
 * Core request primitive with timeout + bounded exponential-backoff retry.
 * On timeout/5xx/429 it retries up to HTTP_MAX_RETRIES; after exhaustion it
 * throws MeteoError so callers can surface an actionable message. Honors the
 * Retry-After header on 429. Success/non-retriable HTTP statuses return an
 * ApiResult (never throw) so tool output shape stays stable. GET responses are
 * served from an in-memory TTL cache (E2) to avoid duplicate upstream calls.
 */
async function requestWithRetry(url: string, opts: RetriableOpts): Promise<ApiResult> {
  const host = getHost(url);

  const cached = getCachedResponse(url, host, opts);
  if (cached) return cached;

  const start = Date.now();
  let lastErr: unknown;

  for (let attempt = 0; attempt <= HTTP_MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      const res = await fetch(url, buildFetchOptions(opts, controller.signal));
      clearTimeout(timer);

      const text = await res.text();
      const elapsedMs = Date.now() - start;

      if (res.ok) {
        const data = parsePayload(text, opts.acceptText);
        const result: ApiResult = { ok: true, url, status: res.status, data, elapsedMs };
        recordMetrics(host, true, elapsedMs);
        if (opts.method !== "POST" && !opts.noCache) {
          cacheStore(url, result);
        }
        return result;
      }

      // 429 or 5xx → retriable; 4xx (except 429) → terminal.
      const retriable = res.status === 429 || res.status >= 500;
      if (retriable && attempt < HTTP_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, calculateBackoff(res, attempt)));
        continue;
      }

      recordMetrics(host, false, elapsedMs);
      return {
        ok: false,
        url,
        status: res.status,
        data: text.slice(0, 2000),
        error: `HTTP ${res.status}: ${text.slice(0, 300)}`,
        elapsedMs,
      };
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;

      if (attempt < HTTP_MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, calculateBackoff(undefined, attempt)));
        continue;
      }

      const elapsedMs = Date.now() - start;
      recordMetrics(host, false, elapsedMs);
      throw formatNetworkError(err, url);
    }
  }

  // Exhausted retries without resolving (shouldn't happen, but keeps TS happy).
  throw new MeteoError("RETRY_EXHAUSTED", `Request to ${url} failed after ${HTTP_MAX_RETRIES} retries`, lastErr);
}

/**
 * Perform a GET request and normalize the result so every tool returns a
 * consistent shape the MCP client and the debug web page can both consume.
 */
export async function apiGet(
  baseUrl: string,
  params: Record<string, string | number | boolean | undefined | string[]>,
  opts: { headers?: Record<string, string>; acceptText?: boolean; noCache?: boolean } = {},
): Promise<ApiResult> {
  const url = buildUrl(baseUrl, params);
  return requestWithRetry(url, {
    headers: opts.headers,
    acceptText: opts.acceptText,
    method: "GET",
    noCache: opts.noCache,
  });
}

/** POST with a JSON body (used by DPC radar downloadProduct). */
export async function apiPostJson(
  url: string,
  body: unknown,
  opts: { headers?: Record<string, string> } = {},
): Promise<ApiResult> {
  return requestWithRetry(url, {
    headers: opts.headers,
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function buildUrl(
  base: string,
  params: Record<string, string | number | boolean | undefined | string[]>,
): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    if (Array.isArray(v)) {
      // Repeated params (e.g. models=ecmwf&models=icon_seamless) — accepted
      // by every Open-Meteo endpoint, unlike comma-joined model lists.
      for (const item of v) {
        if (item !== undefined && item !== "") u.searchParams.append(k, String(item));
      }
    } else {
      u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

/** Format an ApiResult as MCP tool content (text + structured). */
export function toToolResult(result: ApiResult) {
  const { cached: _cached, ...clean } = result;
  const text = JSON.stringify(clean, null, 2);
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: clean,
    isError: !result.ok,
  };
}

/**
 * Validate an ApiResult's payload against a zod schema. Throws MeteoError on
 * a non-ok response or a shape mismatch so malformed upstream JSON surfaces as
 * an actionable message instead of `undefined` fields downstream.
 */
export function validateApiData<T>(result: ApiResult, schema: import("zod").ZodType<T>, source: string): T {
  if (!result.ok) {
    throw new MeteoError(
      "UPSTREAM_ERROR",
      `${source} returned an error (HTTP ${result.status}): ${result.error ?? "unknown"}`,
    );
  }
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) {
    throw new MeteoError(
      "BAD_RESPONSE",
      `${source} returned an unexpected response shape: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => i.path.join(".") || "<root>")
        .join(", ")}`,
    );
  }
  return parsed.data;
}

/** Common query-string params shared by every Open-Meteo endpoint. */
export const openMeteoCommon = {
  timezone: z.string().default("Europe/Rome").describe("IANA timezone, default Europe/Rome"),
  past_days: z.coerce.number().int().min(0).max(92).optional().describe("Days of past data to include"),
  forecast_days: z.coerce.number().int().min(1).max(16).optional().describe("Days of forecast (1-16)"),
};

export const latLon = {
  latitude: z.coerce.number().min(-90).max(90).describe("Latitude in decimal degrees"),
  longitude: z.coerce.number().min(-180).max(180).describe("Longitude in decimal degrees"),
};
