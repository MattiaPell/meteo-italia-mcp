import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerOpenMeteo } from "./open_meteo.js";
import { registerItalianSources } from "./italian_sources.js";
import { registerDpc } from "./dpc.js";
import { registerArpav } from "./regioni/arpav.js";
import { registerMeteotrentino } from "./regioni/meteotrentino.js";
import { registerArpae } from "./regioni/arpae.js";
import { registerArpaFvg } from "./regioni/arpa-fvg.js";
import { registerArpaMarche } from "./regioni/arpa-marche.js";
import { registerArpaLombardia } from "./regioni/arpa-lombardia.js";
import { registerArpaPiemonte } from "./regioni/arpa-piemonte.js";
import { registerBrief } from "./brief.js";
import { registerSummaries } from "./summaries.js";
import {
  registerClimatology,
  registerBioclimaticIndices,
  registerLocalPhenomena,
  registerModelTuning,
  registerEventReliability,
  registerReferenceGuidelines,
  registerVerification,
  registerYearCompare,
  registerPollen,
} from "./reference_tools.js";
import { startDebugServer } from "./debug.js";
import { DEBUG_PORT } from "./http.js";
import { SERVER_INSTRUCTIONS, registerPrompts } from "./instructions.js";
import { log } from "./log.js";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const server = new McpServer(
  {
    name: "meteo-italia-mcp-server",
    version,
  },
  { instructions: SERVER_INSTRUCTIONS },
);

registerOpenMeteo(server);
registerItalianSources(server);
registerDpc(server);
registerArpav(server);
registerMeteotrentino(server);
registerArpae(server);
registerArpaFvg(server);
registerArpaMarche(server);
registerArpaLombardia(server);
registerArpaPiemonte(server);
registerBrief(server);
registerSummaries(server);
registerClimatology(server);
registerBioclimaticIndices(server);
registerLocalPhenomena(server);
registerModelTuning(server);
registerEventReliability(server);
registerReferenceGuidelines(server);
registerVerification(server);
registerYearCompare(server);
registerPollen(server);
registerPrompts(server);

// Stdio transport for MCP clients.
const transport = new StdioServerTransport();
await server.connect(transport);

// Debug web page on a TCP port (independent of stdio), opt-in via METEO_MCP_DEBUG_PORT.
if (DEBUG_PORT !== undefined) startDebugServer(DEBUG_PORT);

log.info("stdio MCP server ready", { version });
