import { describe, it, expect } from "vitest";
import { dynamicWeights, skillsFromVerification } from "../model_scoring.js";

const STATIC = { a: 1.4, b: 1.0, c: 0.7 };

describe("dynamicWeights", () => {
  it("meno di 2 modelli con dati sufficienti → pesi statici", () => {
    const r = dynamicWeights(STATIC, [{ model: "a", n: 9, mae: 1 }]);
    expect(r.applicata).toBe(false);
    expect(r.weights).toEqual(STATIC);
    const r2 = dynamicWeights(STATIC, [
      { model: "a", n: 2, mae: 1 },
      { model: "b", n: 3, mae: 2 },
    ]);
    expect(r2.applicata).toBe(false);
  });

  it("il modello più preciso sale, il meno preciso scende", () => {
    const r = dynamicWeights(STATIC, [
      { model: "a", n: 10, mae: 0.8 },
      { model: "b", n: 10, mae: 2.4 },
    ]);
    expect(r.applicata).toBe(true);
    expect(r.weights.a).toBeGreaterThan(STATIC.a);
    expect(r.weights.b).toBeLessThan(STATIC.b);
    expect(r.weights.c).toBe(0.7); // senza dati: invariato
  });

  it("shrinkage: pochi campioni spostano meno dei molti", () => {
    const skills = (n: number) => [
      { model: "a", n, mae: 0.8 },
      { model: "b", n, mae: 2.4 },
    ];
    const pochi = dynamicWeights(STATIC, skills(5)).weights.a;
    const molti = dynamicWeights(STATIC, skills(30)).weights.a;
    expect(molti).toBeGreaterThan(pochi);
    expect(pochi).toBeGreaterThan(STATIC.a);
  });

  it("fattore limitato a [0.6, 1.5] e MAE nullo non esplode", () => {
    const r = dynamicWeights({ a: 1, b: 1 }, [
      { model: "a", n: 1000, mae: 0 },
      { model: "b", n: 1000, mae: 50 },
    ]);
    const f = Object.fromEntries(r.dettaglio.map((d) => [d.modello, d.fattore]));
    expect(f.a).toBeLessThanOrEqual(1.5);
    expect(f.b).toBeGreaterThanOrEqual(0.6);
  });

  it("modello senza peso statico parte da 1", () => {
    const r = dynamicWeights({}, [
      { model: "x", n: 10, mae: 1 },
      { model: "y", n: 10, mae: 1 },
    ]);
    expect(r.weights.x).toBe(1);
    expect(r.weights.y).toBe(1);
  });
});

describe("skillsFromVerification", () => {
  it("media pesata di MAE Tmax/Tmin; salta modelli senza campioni", () => {
    const out = skillsFromVerification({
      m1: { temperature_max: { n: 10, mae: 1 }, temperature_min: { n: 10, mae: 2 } },
      m2: { temperature_max: { n: 0, mae: null }, temperature_min: { n: 0, mae: null } },
    });
    expect(out).toEqual([{ model: "m1", n: 10, mae: 1.5 }]);
  });
});
