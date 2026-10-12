import { describe, it, expect } from "vitest";
import { calculateStats } from "../verification.js";

describe("calculateStats", () => {
  it("should return null stats for empty array", () => {
    const result = calculateStats([]);
    expect(result).toEqual({ n: 0, mae: null, bias: null, rmse: null });
  });

  it("should calculate stats for a single element array", () => {
    const result = calculateStats([2.5]);
    expect(result).toEqual({ n: 1, mae: 2.5, bias: 2.5, rmse: 2.5 });
  });

  it("should calculate stats for a single negative element", () => {
    const result = calculateStats([-2.5]);
    expect(result).toEqual({ n: 1, mae: 2.5, bias: -2.5, rmse: 2.5 });
  });

  it("should calculate stats for an array of zeros", () => {
    const result = calculateStats([0, 0, 0]);
    expect(result).toEqual({ n: 3, mae: 0, bias: 0, rmse: 0 });
  });

  it("should correctly compute stats for mixed positive and negative numbers", () => {
    // Errors: [1, -2, 3, -4]
    // n = 4
    // mae = (1 + 2 + 3 + 4) / 4 = 10 / 4 = 2.5
    // bias = (1 - 2 + 3 - 4) / 4 = -2 / 4 = -0.5
    // rmse = sqrt((1 + 4 + 9 + 16) / 4) = sqrt(30 / 4) = sqrt(7.5) ≈ 2.7386 -> rounded to 2.7
    const result = calculateStats([1, -2, 3, -4]);
    expect(result).toEqual({
      n: 4,
      mae: 2.5,
      bias: -0.5,
      rmse: 2.7
    });
  });

  it("should handle floating point rounding correctly", () => {
    // [1.111, 2.222, -3.333]
    // mae = (1.111 + 2.222 + 3.333) / 3 = 6.666 / 3 = 2.222 -> 2.2
    // bias = (1.111 + 2.222 - 3.333) / 3 = 0 / 3 = 0
    // rmse = sqrt((1.111^2 + 2.222^2 + (-3.333)^2)/3) = sqrt((1.234321 + 4.937284 + 11.108889)/3) = sqrt(17.280494/3) = sqrt(5.7601646) = 2.4
    const result = calculateStats([1.111, 2.222, -3.333]);
    expect(result.n).toBe(3);
    expect(result.mae).toBe(2.2);
    expect(result.bias).toBe(0);
    expect(result.rmse).toBe(2.4);
  });
});
