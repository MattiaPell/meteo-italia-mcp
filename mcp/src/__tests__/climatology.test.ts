import { describe, it, expect } from "vitest";
import { handleClimatology, registerClimatology } from "../climatology.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

function makeClient(_server: McpServer) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });

  return { client, serverTransport, clientTransport };
}

describe("Climatology Tool", () => {
  it("should match city by name", async () => {
    const res = await handleClimatology({ cityName: "Milano" });
    const content = res.content as any[];
    const text = content[0]?.type === "text" ? content[0].text : "";
    const parsed = JSON.parse(text);

    expect(parsed.ok).toBe(true);
    expect(parsed.data.stations.length).toBeGreaterThan(0);
    expect(parsed.data.stations[0].name.toLowerCase()).toContain("milano");
    expect(parsed.data.stations[0].climatology).toHaveLength(12);
  });

  it("should find closest city by latitude and longitude", async () => {
    // Coordinate vicine a Milano
    const res = await handleClimatology({ latitude: 45.46, longitude: 9.19 });
    const content = res.content as any[];
    const text = content[0]?.type === "text" ? content[0].text : "";
    const parsed = JSON.parse(text);

    expect(parsed.ok).toBe(true);
    expect(parsed.data.stations).toHaveLength(1);
    expect(parsed.data.stations[0].name.toLowerCase()).toContain("milano");
  });

  it("should filter by month", async () => {
    const res = await handleClimatology({ cityName: "Roma", month: 1 });
    const content = res.content as any[];
    const text = content[0]?.type === "text" ? content[0].text : "";
    const parsed = JSON.parse(text);

    expect(parsed.ok).toBe(true);
    expect(parsed.data.stations.length).toBeGreaterThan(0);
    expect(parsed.data.stations[0].climatology).toHaveLength(1);
    expect(parsed.data.stations[0].climatology[0].month).toBe("Gen");
  });

  it("should filter by region", async () => {
    const res = await handleClimatology({ region: "Lombardia" });
    const content = res.content as any[];
    const text = content[0]?.type === "text" ? content[0].text : "";
    const parsed = JSON.parse(text);

    expect(parsed.ok).toBe(true);
    expect(parsed.data.stations.length).toBeGreaterThan(0);
    expect(parsed.data.stations.every((s: any) => s.region.toLowerCase() === "lombardia")).toBe(true);
  });

  it("should return empty if nothing matches", async () => {
    const res = await handleClimatology({ cityName: "NonExistentCityXYZ123" });
    const content = res.content as any[];
    const text = content[0]?.type === "text" ? content[0].text : "";
    const parsed = JSON.parse(text);

    expect(parsed.ok).toBe(true);
    expect(parsed.data.stations).toHaveLength(0);
    expect(parsed.data.count).toBe(0);
  });

  describe("MCP Tool Registration", () => {
    it("should successfully execute tool via MCP client", async () => {
      const server = new McpServer({ name: "test", version: "1.0.0" });
      registerClimatology(server);

      const { client, serverTransport, clientTransport } = makeClient(server);
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const res = await client.callTool({
        name: "meteo_climatology",
        arguments: {
          cityName: "Torino",
        },
      });

      expect(res.isError).toBeFalsy();
      const content = res.content as any[];
      const text = content[0]?.type === "text" ? content[0].text : "";
      const parsed = JSON.parse(text);
      expect(parsed.ok).toBe(true);
      expect(parsed.data.stations.length).toBeGreaterThan(0);
      expect(parsed.data.stations[0].name.toLowerCase()).toContain("torino");
    });
  });
});
