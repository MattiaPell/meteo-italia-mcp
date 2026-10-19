import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { runBrief, registerBrief } from "../brief.js";
import { MeteoError } from "../errors.js";

/**
 * Fixture HTTP mockate: nessuna chiamata reale. apiGet dispatcha sull'URL;
 * DPC (bollettino + radar) e gli adapter ARPA sono mockati a livello modulo.
 * Gli adapter ARPA non coperti (es. Sicilia) escono dalla codepath reale
 * "nonCoperto" senza eseguire nessun modulo regioni/.
 */
const mocks = vi.hoisted(() => ({
  apiGet: vi.fn(),
  fetchLatestBulletin: vi.fn(),
  fetchRadarLatest: vi.fn(),
  runBriefArpa: vi.fn(),
}));

function regioneMockFactory() {
  return {
    runBriefArpa: mocks.runBriefArpa,
    registerArpav: vi.fn(),
    registerMeteotrentino: vi.fn(),
    registerArpae: vi.fn(),
    registerArpaFvg: vi.fn(),
    registerArpaMarche: vi.fn(),
    registerArpaLombardia: vi.fn(),
    registerArpaPiemonte: vi.fn(),
  };
}

vi.mock("../http.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../http.js")>();
  return { ...actual, apiGet: mocks.apiGet };
});

vi.mock("../dpc.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../dpc.js")>();
  return {
    ...actual,
    fetchLatestBulletin: mocks.fetchLatestBulletin,
    fetchRadarLatest: mocks.fetchRadarLatest,
  };
});

// vi.mock è hoistato: nessun loop, le 7 righe devono essere esplicite.
vi.mock("../regioni/arpav.js", () => regioneMockFactory());
vi.mock("../regioni/meteotrentino.js", () => regioneMockFactory());
vi.mock("../regioni/arpa-marche.js", () => regioneMockFactory());
vi.mock("../regioni/arpa-lombardia.js", () => regioneMockFactory());
vi.mock("../regioni/arpa-fvg.js", () => regioneMockFactory());
vi.mock("../regioni/arpae.js", () => regioneMockFactory());
vi.mock("../regioni/arpa-piemonte.js", () => regioneMockFactory());

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** NWP uniforme: nessuna divergenza tra modelli. */
const NWP_OK = {
  latitude: 45.46,
  longitude: 9.19,
  elevation: 100,
  timezone: "Europe/Rome",
  current: {
    time: "2026-08-29T12:00",
    temperature_2m: 25,
    weather_code: 0,
    wind_speed_10m: 5,
    relative_humidity_2m: 60,
  },
  daily: {
    time: ["2026-08-29"],
    temperature_2m_max_ecmwf_ifs025: [30],
    temperature_2m_min_ecmwf_ifs025: [20],
    precipitation_sum_ecmwf_ifs025: [0],
    precipitation_probability_max_ecmwf_ifs025: [10],
    wind_gusts_10m_max_ecmwf_ifs025: [20],
    temperature_2m_max_icon_seamless: [30],
    temperature_2m_min_icon_seamless: [20],
    precipitation_sum_icon_seamless: [0],
    precipitation_probability_max_icon_seamless: [10],
    wind_gusts_10m_max_icon_seamless: [20],
  },
};

/** NWP divergente: spread tmax 5°C, precip max 3mm, current 28°C. */
const NWP_DIVERGENTE = {
  ...NWP_OK,
  current: { ...NWP_OK.current, temperature_2m: 28 },
  daily: {
    ...NWP_OK.daily,
    temperature_2m_max_ecmwf_ifs025: [30],
    temperature_2m_max_icon_seamless: [35],
    precipitation_sum_ecmwf_ifs025: [2],
    precipitation_sum_icon_seamless: [3],
  },
};

const ENSEMBLE_OK = {
  hourly: {
    time: ["2026-08-29T00:00", "2026-08-29T06:00"],
    temperature_2m_spread_ecmwf_ifs025_ensemble_mean: [1, 2],
    precipitation_ecmwf_ifs025_ensemble_mean: [0, 0.5],
    precipitation_spread_ecmwf_ifs025_ensemble_mean: [0.2, 0.8],
  },
};

const ENSEMBLE_DIVERGENTE = {
  hourly: {
    ...ENSEMBLE_OK.hourly,
    temperature_2m_spread_ecmwf_ifs025_ensemble_mean: [3, 5.5],
  },
};

const ZONA_VENETO = (comuni: string[], temporali = 1) => ({
  zona: "Veneto pianura",
  regione: "Veneto",
  comuni,
  normalizedComuni: new Set(comuni.map((c) => c.toLowerCase())),
  livelli: { idraulico: 0, temporali, idrogeologico: 0 },
  testi: { idraulico: "", temporali: temporali ? "Allerta gialla" : "Nessuna allerta", idrogeologico: "" },
  mappa: "",
});

const ALLETE_OK = (comuni: string[], temporali = 1) => ({
  ok: true,
  stamp: "20260829_1430",
  nome: "Bollettino criticità",
  emissione: "2026-08-29T14:30:00",
  today: [ZONA_VENETO(comuni, temporali)],
  tomorrow: [],
});

const RADAR_OK = { ok: true, prodotto: "VMI", stato: "disponibile" };
const ARPA_OK = { ok: true, agenzia: "ARPAV", stazioni: [{ nome: "Rovigo", temp: 24 }] };

/** METAR LIML (Linate, ~7km da Milano centro) e LIMC (Malpensa). */
const METAR_OK = [{ icaoId: "LIML", temp: 25, wspd: 8, wdir: 45, visib: "6+", altim: 1013, rawOb: "LIML 25" }];
const METAR_DIVERGENTE = [
  { icaoId: "LIML", temp: 25, wspd: 8, wdir: 45, visib: "6+", altim: 1013, rawOb: "LIML 25" },
  { icaoId: "LIMC", temp: 26, wspd: 6, wdir: 30, visib: "1", altim: 1012, rawOb: "LIMC 26" },
];

interface FixtureOpts {
  nwp?: unknown;
  nwpErrore?: boolean;
  nwpThrow?: boolean;
  allerte?: unknown;
  allerteThrow?: boolean;
  radar?: unknown;
  radarThrow?: boolean;
  metar?: unknown[] | "throw";
  ensemble?: unknown;
  ensembleThrow?: boolean;
  arpa?: unknown;
  arpaThrow?: boolean;
}

function setFixtures(o: FixtureOpts = {}) {
  mocks.apiGet.mockImplementation((url: string) => {
    if (url.includes("api.open-meteo.com/v1/forecast")) {
      if (o.nwpThrow) return Promise.reject(new MeteoError("NETWORK", `Network error contacting ${url}`));
      if (o.nwpErrore)
        return Promise.resolve({ ok: false, url, status: 503, data: null, error: "HTTP 503: boom", elapsedMs: 1 });
      return Promise.resolve({ ok: true, url, status: 200, data: o.nwp ?? NWP_OK, elapsedMs: 1 });
    }
    if (url.includes("ensemble-api.open-meteo.com")) {
      if (o.ensembleThrow) return Promise.reject(new MeteoError("NETWORK", `Network error contacting ${url}`));
      return Promise.resolve({ ok: true, url, status: 200, data: o.ensemble ?? ENSEMBLE_OK, elapsedMs: 1 });
    }
    if (url.includes("aviationweather.gov")) {
      if (o.metar === "throw")
        return Promise.reject(new MeteoError("TIMEOUT", `Request to ${url} timed out after 10000ms`));
      return Promise.resolve({ ok: true, url, status: 200, data: o.metar ?? METAR_OK, elapsedMs: 1 });
    }
    if (url.includes("geocoding-api.open-meteo.com")) {
      return Promise.reject(new MeteoError("TIMEOUT", `Request to ${url} timed out after 10000ms`));
    }
    return Promise.reject(new Error(`apiGet mock: URL non gestito: ${url}`));
  });
  mocks.fetchLatestBulletin.mockImplementation(() => {
    if (o.allerteThrow) return Promise.reject(new MeteoError("NETWORK", "Network error contacting DPC"));
    return Promise.resolve(o.allerte ?? ALLETE_OK(["Milano", "Rovigo"], 0));
  });
  mocks.fetchRadarLatest.mockImplementation(() => {
    if (o.radarThrow) return Promise.reject(new MeteoError("NETWORK", "Network error contacting radar DPC"));
    return Promise.resolve(o.radar ?? RADAR_OK);
  });
  mocks.runBriefArpa.mockImplementation(() => {
    if (o.arpaThrow) return Promise.reject(new MeteoError("NETWORK", "Network error contacting ARPA"));
    return Promise.resolve(o.arpa ?? ARPA_OK);
  });
}

const PARAM_MILANO = {
  nome: "Milano",
  latitude: 45.4642,
  longitude: 9.19,
  regione: "Veneto",
  days: 1 as const,
  models: "ecmwf_ifs025,icon_seamless",
};

beforeEach(() => {
  setFixtures();
});

afterEach(() => {
  vi.clearAllMocks();
}); // ---------------------------------------------------------------------------
// Unit test runBrief / runBriefCore
// ---------------------------------------------------------------------------

describe("runBrief — tutte le fonti ok", () => {
  it("aggrega 6 fonti, consensus NWP, allerta comune, nessuna divergenza", async () => {
    const r = await runBrief(PARAM_MILANO);
    expect(r.ok).toBe(true);
    expect(r.data.fontiInterrogate).toBe(6);
    expect(r.data.fontiOk).toBe(6);
    expect(r.data.nwp.status).toBe("ok");
    expect(r.data.nwp.modelli).toEqual(["ecmwf_ifs025", "icon_seamless"]);
    expect(r.data.nwp.giorni).toHaveLength(1);
    expect(r.data.nwp.giorni[0].tmaxMedia).toBe(30);
    expect(r.data.nwp.giorni[0].tmaxSpread).toBe(0);
    expect(r.data.nwp.macroarea).toBe("nord_ovest");
    expect(r.data.nwp.pesi).toEqual({ ecmwf_ifs025: 1.3, icon_seamless: 1.0 });
    expect(r.data.nwp.giorni[0].tmaxPesata).toBe(30);
    expect(r.data.allerte.matching).toBe("comune");
    expect(r.data.allerte.comuneTrovato).toBe(true);
    // livelli tutti 0 nel caso pulito: nessuna allerta, nessuna divergenza
    expect(r.data.allerte.allertaMaxOggi).toBe(0);
    expect(r.data.radar.status).toBe("ok");
    expect(r.data.metar.status).toBe("ok");
    expect(r.data.metar.stazioni[0].icao).toBe("LIML");
    expect(r.data.metar.stazioni[0].distKm).not.toBeNull();
    expect(r.data.ensemble.status).toBe("ok");
    expect(r.data.ensemble.tempSpreadMaxC).toBe(2);
    expect(r.data.arpaRegionale.ok).toBe(true);
    expect(r.data.divergenze).toEqual([]);
    expect(r.data.errori).toEqual([]);
  });
});

describe("runBrief — fonti in errore", () => {
  it("NWP non-ok → ok:false e errore riportato, le altre fonti proseguono", async () => {
    setFixtures({ nwpErrore: true });
    const r = await runBrief(PARAM_MILANO);
    expect(r.ok).toBe(false);
    expect(r.data.nwp.status).toBe("errore");
    expect(r.data.fontiOk).toBe(5);
    expect(r.data.errori).toEqual(["Open-Meteo: HTTP 503: boom"]);
  });

  it("bollettino DPC non disponibile → allerte errore + errore accumulato", async () => {
    setFixtures({
      allerte: {
        ok: false,
        stamp: null,
        nome: null,
        emissione: null,
        today: [],
        tomorrow: [],
        error: "bollettino non disponibile",
      },
    });
    const r = await runBrief(PARAM_MILANO);
    expect(r.ok).toBe(true);
    expect(r.data.allerte.status).toBe("errore");
    expect(r.data.fontiOk).toBe(5);
    expect(r.data.errori).toContain("Allerte DPC non disponibili");
  });

  it("METAR in timeout (MeteoError) → fonte errore, brief prosegue", async () => {
    setFixtures({ metar: "throw" });
    const r = await runBrief(PARAM_MILANO);
    expect(r.ok).toBe(true);
    expect(r.data.metar.status).toBe("errore");
    expect(r.data.fontiOk).toBe(5);
  });

  it("radar e ARPA rifiutati → fontiOk calate senza crash", async () => {
    setFixtures({ radarThrow: true, arpaThrow: true });
    const r = await runBrief(PARAM_MILANO);
    expect(r.ok).toBe(true);
    expect(r.data.radar.status).toBe("errore");
    expect(r.data.arpaRegionale.status).toBe("errore");
    expect(r.data.fontiOk).toBe(4);
  });
});

describe("runBrief — calcolo divergenze", () => {
  it("rileva spread NWP, scarto METAR, visibilità, allerta vs precip, ensemble", async () => {
    setFixtures({
      nwp: NWP_DIVERGENTE,
      metar: METAR_DIVERGENTE,
      ensemble: ENSEMBLE_DIVERGENTE,
      allerte: ALLETE_OK(["Milano", "Rovigo"], 1),
    });
    const r = await runBrief(PARAM_MILANO);
    expect(r.ok).toBe(true);
    const d = r.data.divergenze;
    expect(d.some((x: string) => x.includes("Modelli NWP divergono su T max oggi: spread 5°C"))).toBe(true);
    expect(d.some((x: string) => x.includes("METAR LIML") && x.includes("scarta di 3°C"))).toBe(true);
    expect(d.some((x: string) => x.includes("METAR LIMC: visibilità <2000m"))).toBe(true);
    expect(d.some((x: string) => x.includes("Allerta PC ≥ gialla ma precipitazione NWP max 3mm"))).toBe(true);
    expect(d.some((x: string) => x.includes("Spread ensemble T elevato: 5.5°C"))).toBe(true);
    expect(d).toHaveLength(5);
  });
});

describe("runBrief — matching allerte comune → regione → nazionale", () => {
  it("comune non nel bollettino ma regione sì → matching 'regione' con nota", async () => {
    setFixtures({ allerte: ALLETE_OK(["Padova"]) });
    const r = await runBrief(PARAM_MILANO);
    expect(r.data.allerte.matching).toBe("regione");
    expect(r.data.allerte.nota).toContain("regione 'Veneto'");
    expect(r.data.allerte.allertaMaxOggi).toBe(1);
  });

  it("né comune né regione → matching 'nazionale' con massimo nazionale", async () => {
    setFixtures({ allerte: ALLETE_OK(["Firenze"]) });
    const r = await runBrief({ ...PARAM_MILANO, regione: "Sardegna" });
    expect(r.data.allerte.matching).toBe("nazionale");
    expect(r.data.allerte.nota).toContain("massimo nazionale");
    expect(r.data.allerte.oggi).toHaveLength(1);
  });

  it("regione senza adapter ARPA → nonCoperto esplicativo", async () => {
    const r = await runBrief({ ...PARAM_MILANO, regione: "Sicilia" });
    expect(r.data.arpaRegionale.ok).toBe(false);
    expect(r.data.arpaRegionale.nonCoperto).toContain("Nessun adapter ARPA real-time per 'Sicilia'");
  });
});

describe("runBrief — errori di input e robustezza", () => {
  it("parametri mancanti → ok:false con messaggio guida, senza lanciare", async () => {
    const r = await runBrief({});
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Passa nome località oppure latitude+longitude");
  });

  it("geocoding in timeout → runBrief non lancia, ritorna {ok:false, error [TIMEOUT]}", async () => {
    const r = await runBrief({ nome: "Località Inesistente", days: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("[TIMEOUT]");
    expect(r.data).toBeUndefined();
  });

  it("runBrief catch block → se l'errore è MeteoError restituisce ok:false e error formattato", async () => {
    mocks.apiGet.mockRejectedValueOnce(new MeteoError("UPSTREAM_429", "Rate limit exceeded"));
    const r = await runBrief({ nome: "Roma", days: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("[UPSTREAM_429] Rate limit exceeded");
    expect(r.elapsedMs).toEqual(expect.any(Number));
  });

  it("località non trovata in Italia → ok:false con nome riportato", async () => {
    mocks.apiGet.mockImplementation((url: string) => {
      if (url.includes("geocoding-api.open-meteo.com")) {
        return Promise.resolve({ ok: true, url, status: 200, data: { results: [] }, elapsedMs: 1 });
      }
      return Promise.reject(new Error(`apiGet mock: URL non gestito: ${url}`));
    });
    const r = await runBrief({ nome: "Atene", days: 1 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Località 'Atene' non trovata in Italia");
  });

  it("geocoding risolve comune e regione (admin1) quando manca lat/lon", async () => {
    mocks.apiGet.mockImplementation((url: string) => {
      if (url.includes("geocoding-api.open-meteo.com")) {
        return Promise.resolve({
          ok: true,
          url,
          status: 200,
          elapsedMs: 1,
          data: {
            results: [
              {
                name: "Cortina d'Ampezzo",
                latitude: 46.54,
                longitude: 12.13,
                country_code: "IT",
                admin1: "Veneto",
                elevation: 1224,
              },
            ],
          },
        });
      }
      if (url.includes("api.open-meteo.com/v1/forecast")) {
        return Promise.resolve({ ok: true, url, status: 200, data: NWP_OK, elapsedMs: 1 });
      }
      if (url.includes("ensemble-api.open-meteo.com")) {
        return Promise.resolve({ ok: true, url, status: 200, data: ENSEMBLE_OK, elapsedMs: 1 });
      }
      if (url.includes("aviationweather.gov")) {
        return Promise.resolve({ ok: true, url, status: 200, data: METAR_OK, elapsedMs: 1 });
      }
      return Promise.reject(new Error(`apiGet mock: URL non gestito: ${url}`));
    });
    const r = await runBrief({ nome: "Cortina d'Ampezzo", days: 1 });
    expect(r.ok).toBe(true);
    expect(r.data.localita.nome).toBe("Cortina d'Ampezzo");
    expect(r.data.localita.regione).toBe("Veneto");
    expect(r.data.localita.elevation).toBe(1224);
    expect(r.data.localita.lat).toBe(46.54);
  });
});

// ---------------------------------------------------------------------------
// E2E — meteo_brief attraverso il layer MCP reale (InMemoryTransport)
// ---------------------------------------------------------------------------

const CITTÀ = [
  { nome: "Cortina d'Ampezzo", lat: 46.54, lon: 12.13, regione: "Veneto", zona: "montagna dolomitica" },
  { nome: "Venezia", lat: 45.44, lon: 12.33, regione: "Veneto", zona: "costiera lagunare" },
  { nome: "Milano", lat: 45.46, lon: 9.19, regione: "Lombardia", zona: "pianura padana" },
];

describe("meteo_brief e2e (MCP InMemoryTransport)", () => {
  async function callBrief(args: Record<string, unknown>) {
    const server = new McpServer({ name: "test-server", version: "1.0.0" });
    registerBrief(server);
    const client = new Client({ name: "test-client", version: "1.0.0" });
    const [cT, sT] = InMemoryTransport.createLinkedPair();
    await server.connect(sT);
    await client.connect(cT);
    const res = (await client.callTool({ name: "meteo_brief", arguments: args })) as {
      isError?: boolean;
      structuredContent?: { ok: boolean; data: any };
    };
    await client.close();
    return res;
  }

  for (const c of CITTÀ) {
    it(`brief per ${c.nome} (${c.zona}) → isError:false, 6 fonti ok`, async () => {
      const res = await callBrief({ nome: c.nome, latitude: c.lat, longitude: c.lon, regione: c.regione, days: 1 });
      expect(res.isError).toBe(false);
      const sc = res.structuredContent!;
      expect(sc.ok).toBe(true);
      expect(sc.data.localita.nome).toBe(c.nome);
      expect(sc.data.fontiInterrogate).toBe(6);
      expect(sc.data.fontiOk).toBe(6);
      expect(sc.data.arpaRegionale.ok).toBe(true);
      expect(sc.data.errori).toEqual([]);
    });
  }

  it("Palermo (Sicilia): brief ok con ARPA non coperta documentato", async () => {
    const res = await callBrief({ nome: "Palermo", latitude: 38.11, longitude: 13.36, regione: "Sicilia", days: 1 });
    expect(res.isError).toBe(false);
    const sc = res.structuredContent!;
    expect(sc.ok).toBe(true);
    expect(sc.data.fontiOk).toBe(5);
    expect(sc.data.arpaRegionale.ok).toBe(false);
    expect(sc.data.arpaRegionale.nonCoperto).toContain("Sicilia");
  });
});
