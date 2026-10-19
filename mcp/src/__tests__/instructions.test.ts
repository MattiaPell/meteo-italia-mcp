import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { SERVER_INSTRUCTIONS, registerPrompts } from "../instructions.js";

async function connect() {
  const server = new McpServer({ name: "t", version: "1.0.0" }, { instructions: SERVER_INSTRUCTIONS });
  registerPrompts(server);
  const client = new Client({ name: "c", version: "1.0.0" }, { capabilities: {} });
  const [cT, sT] = InMemoryTransport.createLinkedPair();
  await server.connect(sT);
  await client.connect(cT);
  return client;
}

describe("instructions & prompts", () => {
  it("il client riceve le instructions del server", async () => {
    const client = await connect();
    expect(client.getInstructions()).toContain("meteo_brief");
    await client.close();
  });

  it("meteo_report lite e pro includono luogo e richiamo al brief", async () => {
    const client = await connect();
    const lite = await client.getPrompt({ name: "meteo_report", arguments: { luogo: "Rovigo", modo: "lite" } });
    const pro = await client.getPrompt({
      name: "meteo_report",
      arguments: { luogo: "Rovigo", modo: "pro", domanda: "vendemmia" },
    });
    const t = (r: typeof lite) => (r.messages[0].content as { text: string }).text;
    expect(t(lite)).toContain("Rovigo");
    expect(t(lite)).toContain("meteo_brief");
    expect(t(lite)).toContain("Sintesi");
    expect(t(pro)).toContain("vendemmia");
    expect(t(pro)).toContain("nowcasting radar");
    await client.close();
  });
});
