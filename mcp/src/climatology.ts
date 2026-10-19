import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toToolResult, ApiResult } from "./http.js";
import { getDistance } from "./geo.js";
import { climatologyData, ClimatologyStation } from "./climatology_data.js";

// --- 1. CLIMATOLOGY TOOL ----------------------------------------------------

export interface ClimatologyArgs {
  latitude?: number;
  longitude?: number;
  cityName?: string;
  region?: string;
  month?: number;
}

export async function handleClimatology({ latitude, longitude, cityName, region, month }: ClimatologyArgs) {
  const start = Date.now();
  let matchedCity: (ClimatologyStation & { region: string; distanceKm: number }) | null = null;
  let minDistance = Infinity;
  let results: Array<ClimatologyStation & { region: string; distanceKm?: number }> = [];

  const keys = Object.keys(climatologyData);
  const searchRegion = region ? region.toLowerCase() : undefined;
  const filteredKeys = searchRegion ? keys.filter((k) => k.toLowerCase().includes(searchRegion)) : keys;

  const searchCityName = cityName ? cityName.toLowerCase() : undefined;
  for (const regKey of filteredKeys) {
    const cities = climatologyData[regKey] ?? [];
    for (const city of cities) {
      let matchesName = true;
      if (searchCityName) {
        matchesName = city.name.toLowerCase().includes(searchCityName);
      }
      if (matchesName) {
        if (latitude !== undefined && longitude !== undefined) {
          const d = getDistance(latitude, longitude, city.lat, city.lon);
          if (d < minDistance) {
            minDistance = d;
            matchedCity = { ...city, region: regKey, distanceKm: Math.round(d * 10) / 10 };
          }
        } else {
          results.push({ ...city, region: regKey });
        }
      }
    }
  }

  if (latitude !== undefined && longitude !== undefined && matchedCity) {
    results = [matchedCity];
  }

  const formattedResults = results.map((city) => {
    let monthsFiltered = city.months;
    if (month !== undefined) {
      const monthIndex = month - 1;
      monthsFiltered = city.months[monthIndex] ? [city.months[monthIndex]] : [];
    }
    return {
      name: city.name,
      region: city.region,
      latitude: city.lat,
      longitude: city.lon,
      elevation: city.elevation,
      distanceKm: city.distanceKm ?? null,
      climatology: monthsFiltered,
    };
  });

  const res: ApiResult = {
    ok: true,
    url: "mcp://climatology",
    status: 200,
    data: {
      count: formattedResults.length,
      stations: formattedResults,
      info: "ERA5 1991-2020 Normals. Use these baselines to evaluate temperature anomalies and precipitation sums.",
    },
    elapsedMs: Date.now() - start,
  };
  return toToolResult(res);
}

export function registerClimatology(server: McpServer) {
  server.registerTool(
    "meteo_climatology",
    {
      title: "Climatologia ERA5 Italia",
      description:
        "Query climatological normals (1991-2020 ERA5) for over 100 Italian cities/stations. Matches by closest lat/lon or city name. Can return single month or full year, and estimates anomalies / sigma categorization.",
      inputSchema: {
        latitude: z.coerce.number().min(-90).max(90).optional().describe("Latitude of the target location"),
        longitude: z.coerce.number().min(-180).max(180).optional().describe("Longitude of the target location"),
        cityName: z.string().optional().describe("Filter by city name (e.g. 'Milano', 'Roma')"),
        region: z.string().optional().describe("Filter by region name (e.g. 'lombardia')"),
        month: z.coerce.number().int().min(1).max(12).optional().describe("Month number (1=Gen, 12=Dic)"),
      },
      outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    handleClimatology,
  );
}
