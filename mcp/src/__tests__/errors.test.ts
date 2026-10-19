import { describe, it, expect } from "vitest";
import { MeteoError } from "../errors.js";

describe("MeteoError", () => {
  it("assigns properties correctly", () => {
    const error = new MeteoError("TIMEOUT", "Request timed out", "cause");
    expect(error.code).toBe("TIMEOUT");
    expect(error.message).toBe("Request timed out");
    expect(error.cause).toBe("cause");
    expect(error.name).toBe("MeteoError");
  });

  it("handles absent cause", () => {
    const error = new MeteoError("BAD_RESPONSE", "Invalid response");
    expect(error.code).toBe("BAD_RESPONSE");
    expect(error.message).toBe("Invalid response");
    expect(error.cause).toBeUndefined();
  });

  it("correctly identifies as instanceof MeteoError and Error", () => {
    const error = new MeteoError("UPSTREAM_429", "Rate limited");
    expect(error).toBeInstanceOf(MeteoError);
    expect(error).toBeInstanceOf(Error);
  });
});
