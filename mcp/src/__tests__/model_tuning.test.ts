import { describe, it, expect, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerModelTuning, getUhiCorrection } from "../model_tuning.js";

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
      arguments: { macroarea: "sud", modelId: "ecmwf_ifs" },
    })) as ToolResult;
    expect(res.isError).toBe(false);
    const sc = res.structuredContent!;
    expect(sc.ok).toBe(true);
    expect(sc.data.biases.length).toBeGreaterThan(0);
    for (const bias of sc.data.biases) {
      expect(bias.model).toBe("ecmwf_ifs");
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
    expect(sc.data.weights.ecmwf_ifs).toBe(1.5);
    expect(sc.data.weights.gfs_seamless).toBe(1.0);
    await client.close();
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
