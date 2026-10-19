import { describe, it, expect, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerBioclimaticIndices } from "../bioclimatic_indices.js";

function makeClient() {
  const server = new McpServer({ name: "test-server", version: "1.0.0" });
  registerBioclimaticIndices(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  // Set up server
  server.connect(serverTransport);

  // Set up client
  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  client.connect(clientTransport);

  return client;
}

describe("registerBioclimaticIndices", () => {
  let client: Client;

  beforeEach(() => {
    client = makeClient();
  });

  const callTool = async (args: any) => {
    const res = await client.callTool({
      name: "meteo_bioclimatic_indices",
      arguments: { tempC: 20, ...args },
    });
    const firstContent = res.content[0];
    const text = firstContent && firstContent.type === "text" ? firstContent.text : "";
    if (res.isError) {
      throw new Error(`MCP error: ${text}`);
    }
    return text ? JSON.parse(text) : res;
  };

  it("calculates Heat Index (Afa) normally", async () => {
    const res = await callTool({ tempC: 28, relativeHumidity: 50 });
    expect(res.ok).toBe(true);
    expect(res.data.indices.heatIndex).toBeDefined();
    expect(res.data.indices.heatIndex.valueC).toBeGreaterThan(27);
  });

  it("calculates Heat Index danger categories", async () => {
    const res = await callTool({ tempC: 35, relativeHumidity: 80 });
    expect(res.data.indices.heatIndex.category).toMatch(/Pericolo/);
  });

  it("calculates THI", async () => {
    const res = await callTool({ tempC: 30, relativeHumidity: 70 });
    expect(res.data.indices.thi).toBeDefined();
    expect(res.data.indices.thi.status).toBeDefined();
  });

  it("calculates Wind Chill", async () => {
    const res = await callTool({ tempC: 5, windSpeedKmH: 20 });
    expect(res.data.indices.windChill).toBeDefined();
    expect(res.data.indices.windChill.valueC).toBeLessThan(5);
  });

  it("calculates Growing Degree Days (GDD)", async () => {
    const res = await callTool({ tempMinC: 10, tempMaxC: 20, gddBase: 10 });
    expect(res.data.indices.gdd).toBeDefined();
    expect(res.data.indices.gdd.value).toBe(5);
  });

  it("calculates Bilancio Idrico", async () => {
    const res = await callTool({ precip7dMm: 50, et07dMm: 20 });
    expect(res.data.indices.waterBalance).toBeDefined();
    expect(res.data.indices.waterBalance.status).toBe("Surplus Idrico");

    const resDeficit = await callTool({ precip7dMm: 0, et07dMm: 40 });
    expect(resDeficit.data.indices.waterBalance.status).toMatch(/Stress/);
  });

  it("calculates Soil Moisture", async () => {
    const res = await callTool({ soilMoisture0to1cm: 0.1 });
    expect(res.data.indices.soilMoisture.status).toBe("Molto secco (punto di appassimento)");
  });

  describe("Use Cases", () => {
    it("handles agricoltura", async () => {
      const res = await callTool({ useCase: "agricoltura", soilTemp6cm: 12 });
      expect(res.data.thresholds.germination).toBeDefined();
      expect(res.data.thresholds.germination.mais).toBe("Ottimale");
    });

    it("handles vite", async () => {
      const res = await callTool({ useCase: "vite", tempMinC: 11, precip7dMm: 15, relativeHumidity: 95 });
      expect(res.data.thresholds.peronosporaRegolaTreDieci.rischioInfezionePrimaverile).toMatch(/CRITICO/);
    });

    it("handles olivo", async () => {
      const res = await callTool({ useCase: "olivo", tempMinC: -12, tempC: 23 });
      expect(res.data.thresholds.freddoOlivo).toMatch(/DANNI GRAVI/);
      expect(res.data.thresholds.moscaOlivo.stato).toMatch(/Sviluppo ottimale/);
    });

    it("handles apicoltura", async () => {
      const res = await callTool({ useCase: "apicoltura", tempC: 20, windSpeedKmH: 10 });
      expect(res.data.thresholds.voloApi.stato).toMatch(/Attività ottimale/);
    });

    it("handles energia_eolico", async () => {
      const res = await callTool({ useCase: "energia_eolico", windSpeedKmH: 36 }); // 10 m/s
      expect(res.data.indices.energiaEolico).toBeDefined();
      expect(res.data.indices.energiaEolico.powerPercent).toBeGreaterThan(0);
    });

    it("handles energia_fv", async () => {
      const res = await callTool({ useCase: "energia_fv", cloudCover: 90, uvIndex: 1, tempC: 40 });
      expect(res.data.indices.energiaFv.score).toBeLessThan(100);
      expect(res.data.indices.energiaFv.flags).toContain("cielo_coperto");
    });

    it("handles spiaggia_mare", async () => {
      const res = await callTool({ useCase: "spiaggia_mare", seaSurfaceTempC: 15, windSpeedKmH: 40, uvIndex: 1 });
      expect(res.data.indices.beachIndex.score).toBeLessThan(100);
      expect(res.data.indices.beachIndex.flags).toContain("mare_freddo");
    });

    it("handles montagna_sci", async () => {
      const res = await callTool({ useCase: "montagna_sci", snowfallSumCm: 2, tempC: 5, windSpeedKmH: 70 });
      expect(res.data.indices.skiIndex.score).toBeLessThan(100);
      expect(res.data.indices.skiIndex.flags).toContain("scarsa_neve_fresca");
    });
  });

  describe("Nimbus Fire Intelligence", () => {
    it("calculates fire risk EXTREME", async () => {
      const res = await callTool({ tempC: 35, relativeHumidity: 20, windSpeedKmH: 40, soilMoisture0to1cm: 0.1 });
      expect(res.data.indices.nimbusFireIntelligence.riskLevel).toBe("ESTREMO");
    });

    it("calculates fire risk LOW", async () => {
      const res = await callTool({ tempC: 15, relativeHumidity: 80, windSpeedKmH: 5, soilMoisture0to1cm: 0.4 });
      expect(res.data.indices.nimbusFireIntelligence.riskLevel).toBe("BASSO");
    });
  });

  describe("Snow Line Nimbus", () => {
    it("calculates snow line offset with rain intensity and narrow valley", async () => {
      const res = await callTool({
        freezingLevelHeightM: 2000,
        precipIntensityMmH: 15,
        isNarrowValley: true,
        relativeHumidity: 95,
      });
      // Base: 300
      // Intensity > 10: +500
      // Valley: +150
      // RH > 90: -100
      // Total offset: 300 + 500 + 150 - 100 = 850
      // Snow line = 2000 - 850 = 1150
      expect(res.data.indices.snowLineNimbus.calculatedSnowLineM).toBe(1150);
      expect(res.data.indices.snowLineNimbus.totalOffsetM).toBe(850);
    });
  });
});
