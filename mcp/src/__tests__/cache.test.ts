import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiGet, getCacheStats, getCacheSize, CACHE_MAX_ENTRIES } from "../http.js";

describe("apiGet cache (E2)", () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.useRealTimers();
  });

  it("serves a repeat GET from cache without a 2nd fetch", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return new Response(JSON.stringify({ n: calls }), { status: 200 });
    }) as unknown as typeof fetch;

    const before = getCacheStats();
    await apiGet("https://api.open-meteo.com/v1/forecast", { latitude: 1, longitude: 2 });
    const r2 = await apiGet("https://api.open-meteo.com/v1/forecast", { latitude: 1, longitude: 2 });
    await vi.runAllTimersAsync();

    expect(calls).toBe(1);
    expect((r2 as any).cached).toBe(true);
    expect(getCacheStats().hits).toBeGreaterThan(before.hits);
  });

  it("caps the cache at CACHE_MAX_ENTRIES", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
    for (let i = 0; i < CACHE_MAX_ENTRIES + 20; i++) {
      await apiGet("https://api.open-meteo.com/v1/forecast", { latitude: i, longitude: 0 });
    }
    expect(getCacheSize()).toBe(CACHE_MAX_ENTRIES);
  });

  it("dedups concurrent GETs to the same URL into a single fetch", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 50));
      return new Response(JSON.stringify({ n: calls }), { status: 200 });
    }) as unknown as typeof fetch;

    const params = { latitude: 77, longitude: 77 };
    const all = Promise.all([
      apiGet("https://api.open-meteo.com/v1/forecast", params),
      apiGet("https://api.open-meteo.com/v1/forecast", params),
      apiGet("https://api.open-meteo.com/v1/forecast", params),
    ]);
    await vi.runAllTimersAsync();
    const results = await all;

    expect(calls).toBe(1);
    expect(results.every((r) => r.ok && (r.data as { n: number }).n === 1)).toBe(true);
  });

  it("does not dedup concurrent GETs to different URLs", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 50));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const all = Promise.all([
      apiGet("https://api.open-meteo.com/v1/forecast", { latitude: 78, longitude: 1 }),
      apiGet("https://api.open-meteo.com/v1/forecast", { latitude: 78, longitude: 2 }),
    ]);
    await vi.runAllTimersAsync();
    await all;

    expect(calls).toBe(2);
  });

  it("does not dedup concurrent GETs with noCache", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 50));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const params = { latitude: 79, longitude: 79 };
    const all = Promise.all([
      apiGet("https://api.open-meteo.com/v1/forecast", params, { noCache: true }),
      apiGet("https://api.open-meteo.com/v1/forecast", params, { noCache: true }),
    ]);
    await vi.runAllTimersAsync();
    await all;

    expect(calls).toBe(2);
  });

  it("releases the in-flight slot after a failure so a later call retries", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;

    const params = { latitude: 80, longitude: 80 };
    const r1 = await apiGet("https://api.open-meteo.com/v1/forecast", params);
    const r2 = await apiGet("https://api.open-meteo.com/v1/forecast", params);

    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    expect(calls).toBe(2);
  });
});
