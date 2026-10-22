import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toToolResult, ApiResult } from "./http.js";
import {
  getModelsData,
  getMarineData,
  getAirQualityData,
  getMountainData,
  getHydroData,
  getNowcastingData,
  getSatelliteData,
  getLightningData,
  getAviationData,
  getPortalsData,
  getPollenData,
  getUvData,
  getConstructionData,
  getTourismData,
} from "./reference_data.js";

export async function handleReferenceGuidelines({ category }: { category: string }) {
  const start = Date.now();
  let data: unknown = {};

  switch (category) {
    case "models":
      data = getModelsData();
      break;
    case "marine":
      data = getMarineData();
      break;
    case "air_quality":
      data = getAirQualityData();
      break;
    case "mountain":
      data = getMountainData();
      break;
    case "hydro":
      data = getHydroData();
      break;
    case "nowcasting":
      data = getNowcastingData();
      break;
    case "satellite":
      data = getSatelliteData();
      break;
    case "lightning":
      data = getLightningData();
      break;
    case "aviation":
      data = getAviationData();
      break;
    case "portals":
      data = getPortalsData();
      break;
    case "pollen":
      data = getPollenData();
      break;
    case "uv":
      data = getUvData();
      break;
    case "construction":
      data = getConstructionData();
      break;
    case "tourism":
      data = getTourismData();
      break;
  }

  const res: ApiResult = {
    ok: true,
    url: `mcp://reference_guidelines/${category}`,
    status: 200,
    data,
    elapsedMs: Date.now() - start,
  };
  return toToolResult(res);
}

// --- 6. REFERENCE GUIDELINES TOOL -------------------------------------------
export function registerReferenceGuidelines(server: McpServer) {
  server.registerTool(
    "meteo_reference_guidelines",
    {
      title: "Linee Guida e Scale Meteorologiche di Riferimento",
      description:
        "Access static weather reference scales, indexes, guidelines, and tables (such as Beaufort, Douglas, CAMS Air Quality limits, AINEVA avalanche scale, airport ICAO directories, EUMETSAT channels, radar reflectivity tables, river thresholds, and portals fallbacks).",
      inputSchema: {
        category: z
          .enum([
            "models",
            "marine",
            "air_quality",
            "mountain",
            "hydro",
            "nowcasting",
            "satellite",
            "lightning",
            "aviation",
            "portals",
            "pollen",
            "uv",
            "construction",
            "tourism",
          ])
          .describe("The reference category to retrieve guidelines/scales/data for"),
      },
      outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    handleReferenceGuidelines,
  );
}
