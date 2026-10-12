import { describe, it, expect } from "vitest";
import { haversine, getDistance } from "../geo.js";

describe("haversine", () => {
  it("computes Milano→Roma ≈ 477 km", () => {
    const d = haversine({ lat: 45.46, lon: 9.19 }, { lat: 41.89, lon: 12.48 });
    expect(Math.abs(d - 477)).toBeLessThan(5);
  });

  it("is zero for identical coordinates", () => {
    expect(haversine({ lat: 10, lon: 10 }, { lat: 10, lon: 10 })).toBeCloseTo(0);
  });

  it("handles crossing the international date line correctly", () => {
    // 179 and -179 at equator are 2 degrees apart (approx 222 km)
    const d = haversine({ lat: 0, lon: 179 }, { lat: 0, lon: -179 });
    expect(Math.abs(d - 222)).toBeLessThan(5);
  });

  it("computes distance between antipodal points", () => {
    // North pole to South pole is approx 20015 km (half circumference)
    const d = haversine({ lat: 90, lon: 0 }, { lat: -90, lon: 0 });
    expect(Math.abs(d - 20015)).toBeLessThan(50); // Allowing some variance due to Earth's shape approximation in formula
  });

  it("handles very small distances accurately", () => {
    // Two points very close to each other
    const d = haversine({ lat: 45.46, lon: 9.19 }, { lat: 45.4601, lon: 9.19 });
    // 0.0001 deg lat is roughly 11.1 meters = 0.0111 km
    expect(d).toBeGreaterThan(0.01);
    expect(d).toBeLessThan(0.015);
  });

  it("handles points crossing the equator and prime meridian", () => {
    // (1, 1) to (-1, -1)
    const d = haversine({ lat: 1, lon: 1 }, { lat: -1, lon: -1 });
    // Approx 314 km
    expect(Math.abs(d - 314)).toBeLessThan(5);
  });

  it("handles wrap-around coordinates (0 vs 360)", () => {
    // They are the same point effectively, though 360 isn't strictly standard, testing math handles it
    const d = haversine({ lat: 0, lon: 0 }, { lat: 0, lon: 360 });
    // It should be 0 because sin(360/2) = sin(180) = 0
    expect(d).toBeCloseTo(0);
  });

  it("getDistance matches haversine", () => {
    expect(getDistance(45.46, 9.19, 41.89, 12.48)).toBeCloseTo(
      haversine({ lat: 45.46, lon: 9.19 }, { lat: 41.89, lon: 12.48 }),
    );
  });
});

describe("getDistance", () => {
  it("computes Milano→Roma ≈ 477 km", () => {
    const d = getDistance(45.46, 9.19, 41.89, 12.48);
    expect(Math.abs(d - 477)).toBeLessThan(5);
  });

  it("is zero for identical coordinates", () => {
    expect(getDistance(10, 10, 10, 10)).toBeCloseTo(0);
  });

  it("matches haversine results", () => {
    const lat1 = 45.46;
    const lon1 = 9.19;
    const lat2 = 41.89;
    const lon2 = 12.48;
    expect(getDistance(lat1, lon1, lat2, lon2)).toBeCloseTo(
      haversine({ lat: lat1, lon: lon1 }, { lat: lat2, lon: lon2 }),
    );
  });

  it("is commutative", () => {
    const lat1 = 45.46;
    const lon1 = 9.19;
    const lat2 = 41.89;
    const lon2 = 12.48;
    expect(getDistance(lat1, lon1, lat2, lon2)).toBeCloseTo(getDistance(lat2, lon2, lat1, lon1));
  });
});
