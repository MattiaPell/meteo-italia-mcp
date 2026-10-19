import { describe, it, expect } from "vitest";
import { summarizeForecast, inferModels } from "../summaries.js";

/**
 * Copre il gap E5/E6 (.omo/EVOLUTIVE.md): inferModels deve usare
 * normalizeModelId e matchare il suffisso più lungo, senza falsi match
 * su modelli tipo `meteoswiss_icon_seamless` vs `icon_seamless`.
 */
describe("inferModels", () => {
  it("matcha il suffisso più lungo: meteoswiss_icon_seamless, non icon_seamless", () => {
    const daily = {
      time: ["2026-08-29"],
      temperature_2m_max_meteoswiss_icon_seamless: [30],
    };
    const found = inferModels(daily, undefined);
    expect(found).toContain("meteoswiss_icon_seamless");
    expect(found).not.toContain("icon_seamless");
  });

  it("normalizza dash e underscore: icon-eu → icon_eu", () => {
    const daily = {
      time: ["2026-08-29"],
      "temperature_2m_max_icon-eu": [25],
    };
    expect(inferModels(daily, undefined)).toContain("icon_eu");
  });

  it("riconosce ensemble mean col suffisso più lungo (gfs025_ensemble_mean, non gfs025)", () => {
    const daily = {
      time: ["2026-08-29"],
      temperature_2m_gfs025_ensemble_mean: [20],
    };
    const found = inferModels(daily, undefined);
    expect(found).toContain("gfs025_ensemble_mean");
    expect(found).not.toContain("gfs025");
  });

  it("non matcha id esclusi (ecmwf_ifs non è in KNOWN_MODELS)", () => {
    const daily = {
      time: ["2026-08-29"],
      temperature_2m_ecmwf_ifs: [18],
    };
    expect(inferModels(daily, undefined)).toEqual([]);
  });

  it("raccoglie modelli da daily e hourly insieme", () => {
    const daily = {
      time: ["2026-08-29"],
      temperature_2m_max_ecmwf_ifs025: [30],
    };
    const hourly = {
      time: ["2026-08-29T00:00"],
      precipitation_icon_seamless: [0],
    };
    const found = inferModels(daily, hourly);
    expect(found.sort()).toEqual(["ecmwf_ifs025", "icon_seamless"].sort());
  });
});

describe("summarizeForecast", () => {
  const rawMulti = {
    latitude: 45.44,
    longitude: 9.28,
    elevation: 100,
    timezone: "Europe/Rome",
    daily: {
      time: ["2026-08-29", "2026-08-30"],
      temperature_2m_max_ecmwf_ifs025: [33, 30],
      temperature_2m_min_ecmwf_ifs025: [22, 19],
      precipitation_sum_ecmwf_ifs025: [12, 0],
      precipitation_probability_max_ecmwf_ifs025: [80, 10],
      wind_gusts_10m_max_ecmwf_ifs025: [75, 30],
      temperature_2m_max_icon_seamless: [35, 29],
      temperature_2m_min_icon_seamless: [23, 18],
      precipitation_sum_icon_seamless: [12, 1],
      precipitation_probability_max_icon_seamless: [60, 20],
      wind_gusts_10m_max_icon_seamless: [75, 25],
    },
    hourly: {
      time: ["2026-08-29T00:00", "2026-08-29T01:00", "2026-08-29T02:00"],
      weather_code_ecmwf_ifs025: [95, 96, 1],
      precipitation_ecmwf_ifs025: [5, 3, 0],
      weather_code_icon_seamless: [95, 2, 1],
      precipitation_icon_seamless: [1, 0, 0],
    },
  };

  it("estrae le metriche per modello con chiavi con suffisso", () => {
    const out = summarizeForecast(rawMulti, ["ecmwf_ifs025", "icon_seamless"]);
    expect(out.location.latitude).toBe(45.44);
    expect(out.days).toHaveLength(2);

    const d0 = out.days[0];
    expect(d0.date).toBe("2026-08-29");
    const ecm = d0.models["ecmwf_ifs025"];
    expect(ecm.temp_max).toBe(33);
    expect(ecm.temp_min).toBe(22);
    expect(ecm.precip_sum).toBe(12);
    expect(ecm.precip_prob_max).toBe(80);
    expect(ecm.gust_max).toBe(75);
    // 2 ore con precipitazione > 0, 2 ore con weather_code 95-99
    expect(ecm.precip_hours).toBe(2);
    expect(ecm.thunderstorm_hours).toBe(2);

    const icon = d0.models["icon_seamless"];
    expect(icon.temp_max).toBe(35);
    expect(icon.precip_hours).toBe(1);
    expect(icon.thunderstorm_hours).toBe(1);
  });

  it("calcola score e flags: pioggia_forte + vento_forte + caldo_estremo il giorno 1", () => {
    const out = summarizeForecast(rawMulti, ["ecmwf_ifs025", "icon_seamless"]);
    // medie giorno 0: precip 12mm (≥10), gust 75kn (≥70), tmax 34°C (≥34)
    expect(out.days[0].flags).toContain("pioggia_forte");
    expect(out.days[0].flags).toContain("vento_forte");
    expect(out.days[0].flags).toContain("temporale");
    expect(out.days[0].flags).toContain("caldo_estremo");
    // giorno 2: precip ~0.5mm, vento leggero → nessun flag forte
    expect(out.days[1].flags).not.toContain("pioggia_forte");
    expect(out.days[1].flags).not.toContain("vento_forte");
    // score ridotto dal maltempo del giorno 1 rispetto al giorno 2
    expect(out.days[0].score).toBeLessThan(out.days[1].score);
  });

  it("usa inferModels quando la lista modelli non è passata", () => {
    const out = summarizeForecast(rawMulti);
    const d0 = out.days[0];
    expect(Object.keys(d0.models).sort()).toEqual(["ecmwf_ifs025", "icon_seamless"].sort());
  });

  it("fallback a chiave senza suffisso quando c'è un solo modello", () => {
    const rawSingle = {
      latitude: 45,
      longitude: 9,
      timezone: "Europe/Rome",
      daily: {
        time: ["2026-08-29"],
        temperature_2m_max: [28],
        precipitation_sum: [0],
      },
      hourly: {
        time: ["2026-08-29T00:00"],
        weather_code: [0],
        precipitation: [0],
      },
    };
    const out = summarizeForecast(rawSingle, ["icon_seamless"]);
    expect(out.days[0].models["icon_seamless"].temp_max).toBe(28);
  });

  it("normalizza l'id modello passato con dash (icon-eu)", () => {
    const raw = {
      latitude: 45,
      longitude: 9,
      timezone: "Europe/Rome",
      daily: {
        time: ["2026-08-29"],
        temperature_2m_max_icon_eu: [21],
      },
    };
    const out = summarizeForecast(raw, ["icon-eu"]);
    expect(out.days[0].models["icon_eu"].temp_max).toBe(21);
  });

  it("calcola cape_max dall'orario quando il daily non lo fornisce", () => {
    const raw = {
      latitude: 45,
      longitude: 9,
      timezone: "Europe/Rome",
      daily: {
        time: ["2026-08-29"],
        temperature_2m_max_ecmwf_ifs025: [30],
      },
      hourly: {
        time: ["2026-08-29T00:00", "2026-08-29T01:00"],
        cape_ecmwf_ifs025: [500, 1500],
      },
    };
    const out = summarizeForecast(raw, ["ecmwf_ifs025"]);
    expect(out.days[0].models["ecmwf_ifs025"].cape_max).toBe(1500);
  });
  it("cape_max e gust_max da orario sono per-giorno, non sull'intero orizzonte", () => {
    const raw = {
      latitude: 45,
      longitude: 9,
      timezone: "Europe/Rome",
      daily: {
        time: ["2026-08-29", "2026-08-30"],
        temperature_2m_max_ecmwf_ifs025: [30, 28],
      },
      hourly: {
        time: ["2026-08-29T00:00", "2026-08-29T01:00", "2026-08-30T00:00", "2026-08-30T01:00"],
        cape_ecmwf_ifs025: [500, 1500, 100, 200],
        wind_gusts_10m_ecmwf_ifs025: [10, 50, 20, 30],
      },
    };
    const out = summarizeForecast(raw, ["ecmwf_ifs025"]);
    expect(out.days[0].models["ecmwf_ifs025"].cape_max).toBe(1500);
    expect(out.days[1].models["ecmwf_ifs025"].cape_max).toBe(200);
    expect(out.days[0].models["ecmwf_ifs025"].gust_max).toBe(50);
    expect(out.days[1].models["ecmwf_ifs025"].gust_max).toBe(30);
  });

  it("weather_code 80-86 (rovesci) non conta come temporale", () => {
    const raw = {
      latitude: 45,
      longitude: 9,
      timezone: "Europe/Rome",
      daily: { time: ["2026-08-29"], temperature_2m_max_ecmwf_ifs025: [30] },
      hourly: {
        time: ["2026-08-29T00:00", "2026-08-29T01:00", "2026-08-29T02:00"],
        weather_code_ecmwf_ifs025: [80, 85, 95],
        precipitation_ecmwf_ifs025: [1, 1, 1],
      },
    };
    const out = summarizeForecast(raw, ["ecmwf_ifs025"]);
    expect(out.days[0].models["ecmwf_ifs025"].thunderstorm_hours).toBe(1);
  });
});
