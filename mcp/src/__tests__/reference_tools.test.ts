import { describe, it, expect, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  registerClimatology,
  registerBioclimaticIndices,
  registerReferenceGuidelines,
  registerPollen,
  registerLocalPhenomena,
  registerModelTuning,
  registerEventReliability,
} from "../reference_tools.js";

/**
 * Smoke test KB-only tools (nessuna chiamata HTTP): input valido →
 * risposta con isError:false e structuredContent nella shape attesa.
 * I tool sono registrati su un server MCP reale e chiamati via client
 * (stesso percorso di produzione: validazione zod input inclusa).
 */
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

afterEach(async () => {
  // nessuna risorsa persistente, placeholder per simmetria
});

describe("reference tools — smoke KB", () => {
  it("meteo_climatology: cityName+month → stazione con normali mensili", async () => {
    const client = await makeClient(registerClimatology);
    const res = (await client.callTool({
      name: "meteo_climatology",
      arguments: { cityName: "Roma", month: 7 },
    })) as ToolResult;
    expect(res.isError).toBe(false);
    const sc = res.structuredContent!;
    expect(sc.ok).toBe(true);
    expect(sc.data.count).toBeGreaterThan(0);
    const st = sc.data.stations[0];
    expect(st.name.toLowerCase()).toContain("roma");
    expect(st.climatology).toHaveLength(1);
    expect(st.climatology[0].month).toBe("Lug");
    await client.close();
  });

  it("meteo_climatology: lat/lon → stazione più vicina con distanza", async () => {
    const client = await makeClient(registerClimatology);
    const res = (await client.callTool({
      name: "meteo_climatology",
      arguments: { latitude: 45.4642, longitude: 9.19 },
    })) as ToolResult;
    expect(res.isError).toBe(false);
    const sc = res.structuredContent!;
    expect(sc.data.stations).toHaveLength(1);
    expect(sc.data.stations[0].distanceKm).toBeLessThan(30);
    await client.close();
  });

  it("meteo_bioclimatic_indices: input base → indice calcolato senza errori", async () => {
    const client = await makeClient(registerBioclimaticIndices);
    const res = (await client.callTool({
      name: "meteo_bioclimatic_indices",
      arguments: { tempC: 30, relativeHumidity: 60, windSpeedKmH: 10, useCase: "spiaggia_mare", seaSurfaceTempC: 24 },
    })) as ToolResult;
    expect(res.isError).toBe(false);
    const sc = res.structuredContent!;
    expect(sc.ok).toBe(true);
    expect(sc.data).toBeTruthy();
    await client.close();
  });

  it("meteo_bioclimatic_indices: schema rifiuta input privo di tempC", async () => {
    const client = await makeClient(registerBioclimaticIndices);
    const res = (await client.callTool({ name: "meteo_bioclimatic_indices", arguments: {} })) as ToolResult;
    expect(res.isError).toBe(true);
    await client.close();
  });

  it("meteo_reference_guidelines: categoria 'models' → catalogo modelli", async () => {
    const client = await makeClient(registerReferenceGuidelines);
    const res = (await client.callTool({
      name: "meteo_reference_guidelines",
      arguments: { category: "models" },
    })) as ToolResult;
    expect(res.isError).toBe(false);
    const sc = res.structuredContent!;
    expect(sc.ok).toBe(true);
    expect(Array.isArray(sc.data.coreModels)).toBe(true);
    expect(sc.data.coreModels.length).toBeGreaterThan(3);
    await client.close();
  });

  it("meteo_reference_guidelines: categoria 'marine' → scale marine", async () => {
    const client = await makeClient(registerReferenceGuidelines);
    const res = (await client.callTool({
      name: "meteo_reference_guidelines",
      arguments: { category: "marine" },
    })) as ToolResult;
    expect(res.isError).toBe(false);
    expect(res.structuredContent!.ok).toBe(true);
    await client.close();
  });

  it("meteo_pollen: lat/lon+condizioni → output con allergeni e rischio", async () => {
    const client = await makeClient(registerPollen);
    const res = (await client.callTool({
      name: "meteo_pollen",
      arguments: { latitude: 45.46, longitude: 9.19, tempC: 25, relativeHumidity: 50, windSpeedKmH: 8, precipMm: 0 },
    })) as ToolResult;
    expect(res.isError).toBe(false);
    const sc = res.structuredContent!;
    expect(sc.ok).toBe(true);
    expect(sc.data).toBeTruthy();
    await client.close();
  });

  it("meteo_local_phenomena: nebbia padana → flag NEBBIA_PADANA", async () => {
    const client = await makeClient(registerLocalPhenomena);
    const res = (await client.callTool({
      name: "meteo_local_phenomena",
      arguments: {
        latitude: 45.2,
        longitude: 9.5,
        temp2m: 4,
        relHum2m: 98,
        windSpeed10m: 2,
        windDir10m: 135,
        weatherCode: 45,
        cloudCover: 90,
        cloudCoverLow: 95,
      },
    })) as ToolResult;
    expect(res.isError).toBe(false);
    const sc = res.structuredContent!;
    expect(sc.ok).toBe(true);
    expect(sc.data.detectedPhenomena).toContain("NEBBIA_PADANA");
    expect(sc.data.alerts.NEBBIA_PADANA).toBeTruthy();
    await client.close();
  });

  it("meteo_local_phenomena: bora a Trieste → flag BORA", async () => {
    const client = await makeClient(registerLocalPhenomena);
    const res = (await client.callTool({
      name: "meteo_local_phenomena",
      arguments: {
        latitude: 45.65,
        longitude: 13.75,
        temp2m: 6,
        relHum2m: 55,
        windSpeed10m: 45,
        windDir10m: 65,
        weatherCode: 61,
        windGusts10m: 70,
      },
    })) as ToolResult;
    expect(res.isError).toBe(false);
    expect(res.structuredContent!.data.detectedPhenomena).toContain("BORA");
    await client.close();
  });

  it("meteo_model_tuning: macroarea nord_est → pesi modelli + bias", async () => {
    const client = await makeClient(registerModelTuning);
    const res = (await client.callTool({
      name: "meteo_model_tuning",
      arguments: { macroarea: "nord_est", modelId: "icon_d2" },
    })) as ToolResult;
    expect(res.isError).toBe(false);
    const sc = res.structuredContent!;
    expect(sc.ok).toBe(true);
    expect(sc.data).toBeTruthy();
    await client.close();
  });

  it("meteo_model_tuning: macroarea non valida → isError (enum zod)", async () => {
    const client = await makeClient(registerModelTuning);
    const res = (await client.callTool({
      name: "meteo_model_tuning",
      arguments: { macroarea: "tatooine" },
    })) as ToolResult;
    expect(res.isError).toBe(true);
    await client.close();
  });

  it("meteo_event_reliability: nessun input → matrice affidabilità", async () => {
    const client = await makeClient(registerEventReliability);
    const res = (await client.callTool({ name: "meteo_event_reliability", arguments: {} })) as ToolResult;
    expect(res.isError).toBe(false);
    const sc = res.structuredContent!;
    expect(sc.ok).toBe(true);
    expect(sc.data.reliabilityMatrix.convective_storms).toBeTruthy();
    expect(sc.data.reliabilityMatrix.fog).toBeTruthy();
    expect(sc.data.indicativo).toBe(true);
    await client.close();
  });
});
