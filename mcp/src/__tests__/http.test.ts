import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiGet, validateApiData, getMetrics, buildUrl } from "../http.js";
import { MeteoError } from "../errors.js";
import { z } from "zod";

describe("apiGet resilience", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
  });

  it("resolves a fast 200 once", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as unknown as typeof fetch;
    const r = await apiGet("https://example.com", {});
    expect(r.ok).toBe(true);
    expect((r.data as any).ok).toBe(true);
  });

  it("throws MeteoError after timeout + retries", async () => {
    globalThis.fetch = vi.fn((_url: string, init?: any) => {
      const signal: AbortSignal | undefined = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        const onAbort = () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        };
        if (signal) {
          if (signal.aborted) return onAbort();
          signal.addEventListener("abort", onAbort, { once: true });
        }
      });
    }) as unknown as typeof fetch;
    const p = apiGet("https://timeout.example.com", { unique: "timeout-case" }, { noCache: true }).catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await p;
    expect(err).toBeInstanceOf(MeteoError);
    expect((err as MeteoError).code).toBe("TIMEOUT");
  });

  // Regressione E3 (.omo/EVOLUTIVE.md): recordMetrics per 4xx terminali era
  // unreachable code in una versione precedente. Oggi un 404 deve registrare
  // l'errore nelle metriche e ritornare ok:false (mai lanciare).
  it("registra metriche di errore su 4xx terminale (regressione E3)", async () => {
    const host = "e3-regression.example.com";
    const before = getMetrics()[host]?.errors ?? 0;
    globalThis.fetch = vi.fn(async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;
    const r = await apiGet(`https://${host}/v1/missing`, {}, { noCache: true });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
    expect(r.error).toContain("HTTP 404");
    const after = getMetrics()[host]?.errors ?? 0;
    expect(after).toBe(before + 1);
  });
});

describe("validateApiData", () => {
  const schema = z.object({ results: z.array(z.object({ name: z.string() })).optional() });

  it("throws MeteoError on non-ok result", () => {
    expect(() =>
      validateApiData({ ok: false, url: "u", status: 500, data: null, error: "boom", elapsedMs: 1 }, schema, "Src"),
    ).toThrow(MeteoError);
  });

  it("throws MeteoError on bad shape", () => {
    expect(() =>
      validateApiData(
        { ok: true, url: "u", status: 200, data: { results: [{ wrong: 1 }] }, elapsedMs: 1 },
        schema,
        "Src",
      ),
    ).toThrow(MeteoError);
  });

  it("returns parsed data on valid shape", () => {
    const data = validateApiData(
      { ok: true, url: "u", status: 200, data: { results: [{ name: "Roma" }] }, elapsedMs: 1 },
      schema,
      "Src",
    );
    expect(data.results?.[0].name).toBe("Roma");
  });
});

describe("buildUrl", () => {
  it("appends basic string, number, and boolean parameters", () => {
    const url = buildUrl("https://example.com/api", {
      q: "rome",
      limit: 10,
      active: true,
    });
    expect(url).toBe("https://example.com/api?q=rome&limit=10&active=true");
  });

  it("ignores undefined and empty string values", () => {
    const url = buildUrl("https://example.com/api", {
      q: "rome",
      empty: "",
      missing: undefined,
      valid: "yes",
    });
    expect(url).toBe("https://example.com/api?q=rome&valid=yes");
  });

  it("handles array parameters by appending multiple times", () => {
    const url = buildUrl("https://example.com/api", {
      models: ["ecmwf", "icon"],
      ids: ["1", "2", "3"],
    });
    expect(url).toBe("https://example.com/api?models=ecmwf&models=icon&ids=1&ids=2&ids=3");
  });

  it("filters out undefined and empty strings from arrays", () => {
    const url = buildUrl("https://example.com/api", {
      models: ["ecmwf", "", undefined as unknown as string, "icon"],
    });
    // Array values that are undefined or empty string are ignored
    expect(url).toBe("https://example.com/api?models=ecmwf&models=icon");
  });

  it("properly URL-encodes keys and values", () => {
    const url = buildUrl("https://example.com/api", {
      "foo bar": "baz qux",
      special: "a&b=c?",
    });
    expect(url).toBe("https://example.com/api?foo+bar=baz+qux&special=a%26b%3Dc%3F");
  });
});
