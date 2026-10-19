import { describe, it, expect, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerModelTuning, getWeights, getUhiCorrection, macroareaFor, weightedMean } from "../model_tuning.js";

async function makeClient(...registrations: Array<(s: McpServer) => void>): Promise<Client> {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  for (const reg of registrations) reg(server);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [cT, sT] = InMemoryTransport.createLinkedPair();
  await server.connect(sT);
  await client.connect(cT);
  return client;
}

type ToolResult = {
  isError?: boolean;
  structuredContent?: { ok: boolean; url: string; status: number; data: any; elapsedMs: number };
  content?: Array<{ type: string; text: string }>;
};

afterEach(async () => {});

describe("meteo_model_tuning", () => {
  it("UHI Correction (Optimal conditions)", async () => {
    const client = await makeClient(registerModelTuning);
    const res = (await client.callTool({
      name: "meteo_model_tuning",
      arguments: { macroarea: "nord_ovest", cityName: "milano", cloudCover: 10, windSpeedKmH: 4 },
    })) as ToolResult;
    expect(res.isError).toBe(false);
    const sc = res.structuredContent!;
    expect(sc.ok).toBe(true);
    expect(sc.data.uhiCorrection).toBeDefined();
    expect(sc.data.uhiCorrection.conditionsMet).toBe(true);
    expect(sc.data.uhiCorrection.appliedDeltaMin).toBe(2.5);
    await client.close();
  });

  it("UHI Correction (Sub-optimal conditions)", async () => {
    const client = await makeClient(registerModelTuning);
    const res = (await client.callTool({
      name: "meteo_model_tuning",
      arguments: { macroarea: "centro", cityName: "roma", cloudCover: 80, windSpeedKmH: 15 },
    })) as ToolResult;
    expect(res.isError).toBe(false);
    const sc = res.structuredContent!;
    expect(sc.ok).toBe(true);
    expect(sc.data.uhiCorrection).toBeDefined();
    expect(sc.data.uhiCorrection.conditionsMet).toBe(false);
    expect(sc.data.uhiCorrection.appliedDeltaMin).toBe(0);
    await client.close();
  });

  it("UHI Correction (Invalid city)", async () => {
    const client = await makeClient(registerModelTuning);
    const res = (await client.callTool({
      name: "meteo_model_tuning",
      arguments: { macroarea: "sud", cityName: "unknown_city" },
    })) as ToolResult;
    expect(res.isError).toBe(false);
    const sc = res.structuredContent!;
    expect(sc.ok).toBe(true);
    expect(sc.data.uhiCorrection).toBeNull();
    await client.close();
  });

  it("Model Biases (Filtered by model)", async () => {
    const client = await makeClient(registerModelTuning);
    const res = (await client.callTool({
      name: "meteo_model_tuning",
      arguments: { macroarea: "sud", modelId: "ecmwf_ifs025" },
    })) as ToolResult;
    expect(res.isError).toBe(false);
    const sc = res.structuredContent!;
    expect(sc.ok).toBe(true);
    expect(sc.data.biases.length).toBeGreaterThan(0);
    for (const bias of sc.data.biases) {
      expect(bias.model).toBe("ecmwf_ifs025");
    }
    await client.close();
  });

  it("Model Weights (Macroarea)", async () => {
    const client = await makeClient(registerModelTuning);
    const res = (await client.callTool({
      name: "meteo_model_tuning",
      arguments: { macroarea: "sud" },
    })) as ToolResult;
    expect(res.isError).toBe(false);
    const sc = res.structuredContent!;
    expect(sc.ok).toBe(true);
    expect(sc.data.weights.ecmwf_ifs025).toBe(1.5);
    expect(sc.data.weights.gfs_seamless).toBe(1.0);
    await client.close();
  });
});

describe("getWeights", () => {
  it("should return correct weights for nord_ovest", () => {
    const weights = getWeights("nord_ovest");
    expect(weights.icon_d2).toBe(1.4);
    expect(weights.ecmwf_ifs025).toBe(1.3);
    expect(weights.meteoswiss_icon_seamless).toBe(1.3);
    expect(weights.italia_meteo_arpae_icon_2i).toBe(1.2);
    expect(weights.icon_seamless).toBe(1.0);
    expect(weights.arome_france).toBe(0.9);
    expect(weights.gfs_seamless).toBe(0.7);
  });

  it("should return correct weights for alpi", () => {
    const weights = getWeights("alpi");
    expect(weights.icon_d2).toBe(1.5);
    expect(weights.meteoswiss_icon_seamless).toBe(1.4);
    expect(weights.ecmwf_ifs025).toBe(1.2);
    expect(weights.geosphere_seamless).toBe(1.2);
    expect(weights.italia_meteo_arpae_icon_2i).toBe(1.1);
    expect(weights.icon_seamless).toBe(0.9);
  });

  it("should return empty object for unknown macroarea", () => {
    const weights = getWeights("unknown_macroarea");
    expect(weights).toEqual({});
  });

  it("should normalize model IDs", () => {
    // getWeights internally calls normalizeModelId on the keys of the hardcoded dict
    // we can check if expected normalized keys are present
    const weights = getWeights("sud");
    expect(weights.ecmwf_ifs025).toBe(1.5);
    expect(weights.ecmwf_aifs025).toBe(1.2);
    expect(weights.arpege_europe).toBe(1.2);
    expect(weights.gfs_seamless).toBe(1.0);
    expect(weights.icon_seamless).toBe(0.9);
    expect(weights.meteofrance_seamless).toBe(0.9);
  });
});

describe("getUhiCorrection", () => {
  it("returns null if cityName is missing", () => {
    expect(getUhiCorrection()).toBeNull();
  });

  it("returns null for unknown city", () => {
    expect(getUhiCorrection("venezia")).toBeNull();
  });

  it("applies max UHI for optimal conditions (low clouds, low wind)", () => {
    const res = getUhiCorrection("milano", 10, 2);
    expect(res).not.toBeNull();
    expect(res!.conditionsMet).toBe(true);
    expect(res!.appliedDeltaMin).toBe(2.5);
  });

  it("applies 0 delta for sub-optimal conditions (high clouds, low wind)", () => {
    const res = getUhiCorrection("milano", 50, 2);
    expect(res).not.toBeNull();
    expect(res!.conditionsMet).toBe(false);
    expect(res!.appliedDeltaMin).toBe(0);
  });

  it("applies 0 delta for sub-optimal conditions (low clouds, high wind)", () => {
    const res = getUhiCorrection("milano", 10, 15);
    expect(res).not.toBeNull();
    expect(res!.conditionsMet).toBe(false);
    expect(res!.appliedDeltaMin).toBe(0);
  });

  it("assumes optimal conditions if cloudCover and windSpeedKmH are omitted", () => {
    const res = getUhiCorrection("milano");
    expect(res).not.toBeNull();
    expect(res!.conditionsMet).toBe(true);
    expect(res!.appliedDeltaMin).toBe(2.5);
  });
});

describe("getUhiCorrection", () => {
  it("returns null if cityName is missing", () => {
    expect(getUhiCorrection()).toBeNull();
  });

  it("returns null for unknown city", () => {
    expect(getUhiCorrection("venezia")).toBeNull();
  });

  it("applies max UHI for optimal conditions (low clouds, low wind)", () => {
    const res = getUhiCorrection("milano", 10, 2);
    expect(res).not.toBeNull();
    expect(res!.conditionsMet).toBe(true);
    expect(res!.appliedDeltaMin).toBe(2.5);
  });

  it("applies 0 delta for sub-optimal conditions (high clouds, low wind)", () => {
    const res = getUhiCorrection("milano", 50, 2);
    expect(res).not.toBeNull();
    expect(res!.conditionsMet).toBe(false);
    expect(res!.appliedDeltaMin).toBe(0);
  });

  it("applies 0 delta for sub-optimal conditions (low clouds, high wind)", () => {
    const res = getUhiCorrection("milano", 10, 15);
    expect(res).not.toBeNull();
    expect(res!.conditionsMet).toBe(false);
    expect(res!.appliedDeltaMin).toBe(0);
  });

  it("assumes optimal conditions if cloudCover and windSpeedKmH are omitted", () => {
    const res = getUhiCorrection("milano");
    expect(res).not.toBeNull();
    expect(res!.conditionsMet).toBe(true);
    expect(res!.appliedDeltaMin).toBe(2.5);
  });

  it("handles whitespace and case insensitivity", () => {
    const res = getUhiCorrection("  rOmA  ");
    expect(res).not.toBeNull();
    expect(res!.cityName).toBe("  rOmA  "); // Preserves original name in output
    expect(res!.deltaTMax).toBe(1.0);
    expect(res!.deltaTMin).toBe(2.0);
  });
});

describe("macroareaFor", () => {
  it.each([
    ["Milano", 45.46, 9.19, 120, "nord_ovest"],
    ["Venezia", 45.44, 12.33, 1, "nord_est"],
    ["Cortina", 46.54, 12.14, 1224, "alpi"],
    ["Firenze", 43.77, 11.25, 50, "centro_nord"],
    ["Roma", 41.9, 12.5, 20, "centro"],
    ["Ancona", 43.6, 13.5, 16, "costa_adriatica"],
    ["Napoli", 40.85, 14.27, 17, "sud"],
    ["Palermo", 38.12, 13.36, 14, "sicilia"],
    ["Cagliari", 39.22, 9.12, 4, "sardegna"],
    ["L'Aquila", 42.35, 13.4, 714, "appennino"],
  ])("%s → %s", (_n, lat, lon, elev, expected) => {
    expect(macroareaFor(lat, lon, elev)).toBe(expected);
  });
});

describe("weightedMean", () => {
  it("pesa per modello e ignora null", () => {
    const w = { ecmwf_ifs025: 2, gfs_seamless: 1 };
    expect(weightedMean({ ecmwf_ifs025: 30, gfs_seamless: 27, icon_d2: null }, w)).toBe(29);
  });
  it("modello senza peso vale 1.0; nessun valore → null", () => {
    expect(weightedMean({ sconosciuto: 10, ecmwf_ifs025: 20 }, { ecmwf_ifs025: 3 })).toBe(17.5);
    expect(weightedMean({ a: null }, {})).toBeNull();
  });
});
