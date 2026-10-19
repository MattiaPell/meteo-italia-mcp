import { describe, it, expect } from "vitest";
import { memberSeries, summarizeEnsemble } from "../ensemble_probs.js";

describe("memberSeries", () => {
  it("raccoglie controllo e membri, con o senza suffisso modello", () => {
    const h = {
      time: ["a"],
      temperature_2m: [1],
      temperature_2m_member01: [2],
      temperature_2m_member02_ecmwf_ifs025: [3],
      temperature_2m_spread: [9],
      precipitation: [0],
    };
    expect(memberSeries(h, "temperature_2m")).toEqual([[1], [2], [3]]);
  });
});

describe("summarizeEnsemble", () => {
  // 4 membri, 2 giorni da 2 ore ciascuno
  const hourly = {
    time: ["2026-10-20T00:00", "2026-10-20T12:00", "2026-10-21T00:00", "2026-10-21T12:00"],
    precipitation: [0, 0, 0.5, 0.5],
    precipitation_member01: [0.6, 0.6, 0, 0],
    precipitation_member02: [5, 6, 0, 0],
    precipitation_member03: [0, 0, 0, 0],
    temperature_2m: [-1, 5, 8, 15],
    temperature_2m_member01: [2, 9, 8, 15],
    temperature_2m_member02: [3, 10, 9, 36],
    temperature_2m_member03: [4, 11, 9, 16],
    wind_gusts_10m: [10, 10, 10, 10],
    wind_gusts_10m_member01: [10, 10, 10, 10],
    wind_gusts_10m_member02: [10, 61, 10, 10],
    wind_gusts_10m_member03: [10, 10, 10, 10],
  };
  const out = summarizeEnsemble(hourly)!;

  it("conta i membri", () => {
    expect(out.membri).toBe(4);
  });

  it("probabilità giorno 1: pioggia ≥1mm 2/4, ≥10mm 1/4, gelo 1/4, raffica 1/4", () => {
    expect(out.probabilita[0]).toEqual({
      data: "2026-10-20",
      pPioggia1mm: 50,
      pPioggia10mm: 25,
      pGelo: 25,
      pCaldoEstremo: 0,
      pRaffica60: 25,
    });
  });

  it("probabilità giorno 2: pioggia ≥1mm 1/4 (controllo 1.0), caldo 1/4", () => {
    expect(out.probabilita[1]).toMatchObject({
      data: "2026-10-21",
      pPioggia1mm: 25,
      pPioggia10mm: 0,
      pGelo: 0,
      pCaldoEstremo: 25,
    });
  });

  it("spread è la deviazione standard tra i membri", () => {
    expect(out.tempSpreadMaxC).toBeGreaterThan(0);
    expect(out.precipSpreadMaxMm).toBeGreaterThan(0);
  });

  it("senza membri → null", () => {
    expect(summarizeEnsemble({ time: ["2026-10-20T00:00"], temperature_2m: [1] })).toBeNull();
    expect(summarizeEnsemble({})).toBeNull();
  });
});
