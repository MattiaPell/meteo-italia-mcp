import { describe, it, expect } from "vitest";
import { extractMetarObs, verifyAgainstMetar, skillsFromMetar } from "../metar_verification.js";

const T0 = Date.parse("2026-10-18T10:00:00Z") / 1000;

describe("extractMetarObs", () => {
  it("legge obsTime (epoch) e reportTime come ripiego; scarta record senza temperatura", () => {
    const obs = extractMetarObs([
      { obsTime: T0, temp: 15 },
      { reportTime: "2026-10-18 11:00:00", temp: 16 },
      { obsTime: T0, temp: null },
      { temp: 3 },
      null,
    ]);
    expect(obs).toEqual([
      { time: T0, tempC: 15 },
      { time: T0 + 3600, tempC: 16 },
    ]);
  });
  it("payload non valido → []", () => {
    expect(extractMetarObs(undefined)).toEqual([]);
    expect(extractMetarObs({ data: "x" })).toEqual([]);
  });
});

describe("verifyAgainstMetar", () => {
  const hourly = {
    time: ["2026-10-18T10:00", "2026-10-18T11:00", "2026-10-18T12:00"],
    temperature_2m_m1: [15, 16, 17],
    temperature_2m_m2: [18, 19, 20],
  };
  const obs = [
    { time: T0 - 600, tempC: 15 }, // 09:50 → ora 10:00
    { time: T0 + 3600 + 300, tempC: 16 }, // 11:05 → ora 11:00
    { time: T0 + 7200, tempC: 15 }, // 12:00
  ];

  it("accoppia per ora e calcola bias/MAE per modello", () => {
    const v = verifyAgainstMetar(obs, hourly, ["m1", "m2"]);
    expect(v.oreAccoppiate).toBe(3);
    expect(v.perModello.m1).toMatchObject({ n: 3, mae: 0.7, bias: 0.7 });
    expect(v.perModello.m2).toMatchObject({ n: 3, mae: 3.7, bias: 3.7 });
  });

  it("più osservazioni nella stessa ora: vince la più vicina all'ora piena", () => {
    const v = verifyAgainstMetar(
      [
        { time: T0 - 1200, tempC: 99 },
        { time: T0 + 60, tempC: 15 },
      ],
      hourly,
      ["m1"],
    );
    expect(v.perModello.m1).toMatchObject({ n: 1, mae: 0 });
  });

  it("10:33 si accoppia all'ora delle 11:00", () => {
    const v = verifyAgainstMetar([{ time: T0 + 2000, tempC: 16 }], hourly, ["m1"]);
    expect(v.perModello.m1).toMatchObject({ n: 1, mae: 0 });
  });

  it("modello singolo: usa temperature_2m senza suffisso", () => {
    const v = verifyAgainstMetar([{ time: T0, tempC: 14 }], { time: hourly.time, temperature_2m: [15, 16, 17] }, ["x"]);
    expect(v.perModello.x).toMatchObject({ n: 1, bias: 1 });
  });
});

describe("skillsFromMetar", () => {
  it("n in giorni equivalenti, salta modelli senza coppie", () => {
    const out = skillsFromMetar({
      oreAccoppiate: 72,
      perModello: {
        a: { n: 72, mae: 1.2, bias: 0, rmse: 1.5 },
        b: { n: 0, mae: null, bias: null, rmse: null },
      },
    });
    expect(out).toEqual([{ model: "a", n: 3, mae: 1.2 }]);
  });
});
