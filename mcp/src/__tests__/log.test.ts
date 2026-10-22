import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { log, errFields } from "../log.js";

const mockWrite = () => vi.spyOn(process.stderr, "write").mockImplementation(() => true);

describe("log", () => {
  let write: ReturnType<typeof mockWrite>;
  beforeEach(() => {
    write = mockWrite();
  });
  afterEach(() => {
    write.mockRestore();
    delete process.env.METEO_MCP_LOG_LEVEL;
  });

  it("scrive una riga JSON su stderr con level, msg e campi", () => {
    log.warn("hello", { host: "x.it" });
    expect(write).toHaveBeenCalledTimes(1);
    const line = String(write.mock.calls[0][0]);
    expect(line.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({ level: "warn", msg: "hello", host: "x.it" });
    expect(typeof parsed.ts).toBe("string");
  });

  it("default info: scarta debug", () => {
    log.debug("nascosto");
    expect(write).not.toHaveBeenCalled();
    log.info("visibile");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("METEO_MCP_LOG_LEVEL=debug mostra debug", () => {
    process.env.METEO_MCP_LOG_LEVEL = "debug";
    log.debug("visibile");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("METEO_MCP_LOG_LEVEL=error scarta warn", () => {
    process.env.METEO_MCP_LOG_LEVEL = "error";
    log.warn("nascosto");
    log.error("visibile");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("METEO_MCP_LOG_LEVEL=silent non scrive nulla", () => {
    process.env.METEO_MCP_LOG_LEVEL = "silent";
    log.error("nascosto");
    expect(write).not.toHaveBeenCalled();
  });

  it("livello non valido → info", () => {
    process.env.METEO_MCP_LOG_LEVEL = "boh";
    log.debug("nascosto");
    log.info("visibile");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("errFields gestisce Error e valori non-Error", () => {
    expect(errFields(new Error("boom"))).toEqual({ error: "boom" });
    expect(errFields("x")).toEqual({ error: "x" });
  });
});
