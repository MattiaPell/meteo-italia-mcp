import { describe, it, expect } from "vitest";
import { extractAviationWeatherStations } from "../italian_sources.js";

describe("extractAviationWeatherStations", () => {
  it("should handle an array payload directly", () => {
    const payload = [
      { icaoId: "LIRF", temp: 18, wdir: 180, wspd: 12, visib: 9999 },
      { icaoId: "LIML", temp: 15, wdir: 360, wspd: 5, visib: 5000 },
    ];
    const result = extractAviationWeatherStations(payload);
    expect(result).toHaveLength(2);
    expect(result[0].icao).toBe("LIRF");
    expect(result[1].icao).toBe("LIML");
  });

  it("should handle payload with a .data property", () => {
    const payload = {
      data: [
        { icaoId: "LIRF", temp: 18 },
        { icaoId: "LIML", temp: 15 },
      ],
    };
    const result = extractAviationWeatherStations(payload);
    expect(result).toHaveLength(2);
    expect(result[0].icao).toBe("LIRF");
  });

  it("should handle payload with a .features property", () => {
    const payload = {
      features: [
        { icaoId: "LIRF", temp: 18 },
        { icaoId: "LIML", temp: 15 },
      ],
    };
    const result = extractAviationWeatherStations(payload);
    expect(result).toHaveLength(2);
    expect(result[0].icao).toBe("LIRF");
  });

  it("should handle a single object payload", () => {
    const payload = { icaoId: "LIRF", temp: 18 };
    const result = extractAviationWeatherStations(payload);
    expect(result).toHaveLength(1);
    expect(result[0].icao).toBe("LIRF");
  });

  it("should filter out falsy values in the array", () => {
    const payload = [{ icaoId: "LIRF", temp: 18 }, null, undefined, false, { icaoId: "LIML", temp: 15 }];
    const result = extractAviationWeatherStations(payload);
    expect(result).toHaveLength(2);
    expect(result[0].icao).toBe("LIRF");
    expect(result[1].icao).toBe("LIML");
  });

  it("should parse using parseRawMetar when only rawOb is provided without JSON fields", () => {
    const payload = [{ rawOb: "LIRF 041250Z 18012KT 9999 FEW030 18/12 Q1012 NOSIG" }];
    const result = extractAviationWeatherStations(payload);
    expect(result).toHaveLength(1);
    expect(result[0].tempC).toBe(18);
    expect(result[0].windKt).toBe(12);
    expect(result[0].windDir).toBe(180);
    expect(result[0].visibilityM).toBe(9999);
  });

  it("should parse using parseRawMetar when only raw_text is provided without JSON fields", () => {
    const payload = [{ raw_text: "LIML 041250Z 36005KT 5000 15/10 Q1015" }];
    const result = extractAviationWeatherStations(payload);
    expect(result).toHaveLength(1);
    expect(result[0].tempC).toBe(15);
    expect(result[0].windKt).toBe(5);
    expect(result[0].windDir).toBe(360);
    expect(result[0].visibilityM).toBe(5000);
  });

  it("should parse directly using parseMetarStation when JSON fields are present", () => {
    // Both raw text and json fields present, should favor json fields
    const payload = [{ icaoId: "LIRZ", temp: 20, rawOb: "LIRZ 041250Z 18012KT 9999 18/12 Q1012 NOSIG" }];
    const result = extractAviationWeatherStations(payload);
    expect(result).toHaveLength(1);
    // tempC should be 20 from JSON, not 18 from rawOb
    expect(result[0].tempC).toBe(20);
    expect(result[0].icao).toBe("LIRZ");
  });

  it("should pass nwpTempC down correctly for delta calculations", () => {
    const payload = [
      { icaoId: "LIRF", temp: 18 }, // actual temp is 18
    ];
    const nwpTempC = 20; // forecast temp is 20
    const result = extractAviationWeatherStations(payload, nwpTempC);
    expect(result).toHaveLength(1);
    expect(result[0].decodedVsNwp.tempScarto).toBe(2); // |18 - 20| = 2
  });

  it("should pass nwpTempC down correctly when using parseRawMetar", () => {
    const payload = [
      { rawOb: "LIRF 041250Z 18012KT 9999 18/12 Q1012 NOSIG" }, // actual temp is 18
    ];
    const nwpTempC = 15; // forecast temp is 15
    const result = extractAviationWeatherStations(payload, nwpTempC);
    expect(result).toHaveLength(1);
    expect(result[0].decodedVsNwp.tempScarto).toBe(3); // |18 - 15| = 3
  });
});
