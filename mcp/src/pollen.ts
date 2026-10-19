import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toToolResult } from "./http.js";

// --- POLLEN FORECAST CONSTANTS & HELPERS ------------------------------------

const POLLEN_CALENDAR = [
  {
    pollen: "ontano",
    nord: new Set([1, 2, 3]),
    centro_sud: new Set([12, 1, 2]),
    nordPeak: false,
    centro_sudPeak: false,
  },
  { pollen: "betulla", nord: new Set([3, 4]), centro_sud: new Set([2, 3]), nordPeak: true, centro_sudPeak: true },
  {
    pollen: "cipresso",
    nord: new Set([2, 3, 4]),
    centro_sud: new Set([1, 2, 3]),
    nordPeak: false,
    centro_sudPeak: false,
  },
  {
    pollen: "graminacee",
    nord: new Set([4, 5, 6]),
    centro_sud: new Set([3, 4, 5]),
    nordPeak: false,
    centro_sudPeak: false,
  },
  { pollen: "olivo", nord: new Set([5, 6]), centro_sud: new Set([4, 5]), nordPeak: true, centro_sudPeak: true },
  {
    pollen: "parietaria",
    nord: new Set([3, 4, 5, 6, 7, 8, 9, 10]),
    centro_sud: new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
    nordPeak: false,
    centro_sudPeak: false,
  },
  { pollen: "artemisia", nord: new Set([7, 8, 9]), centro_sud: new Set([7, 8]), nordPeak: false, centro_sudPeak: true },
  { pollen: "ambrosia", nord: new Set([8, 9]), centro_sud: new Set([8, 9]), nordPeak: true, centro_sudPeak: true },
];

const THRESHOLDS: Record<string, { low: number; medium: number; high: number }> = {
  graminacee: { low: 10, medium: 30, high: 50 },
  olivo: { low: 5, medium: 25, high: 50 },
  betulla: { low: 16, medium: 50, high: 80 },
  parietaria: { low: 20, medium: 70, high: 100 },
  ambrosia: { low: 5, medium: 25, high: 50 },
  cipresso: { low: 30, medium: 90, high: 150 },
};

function calculateBaseLevel(
  tempC: number,
  relativeHumidity: number,
  windSpeedKmH: number,
  precipMm: number,
  cloudCover?: number,
): number {
  let baseLevel = 50;
  if (tempC < 5) baseLevel *= 0.2;
  else if (tempC < 10) baseLevel *= 0.5;
  else if (tempC > 30) baseLevel *= 0.7;

  if (precipMm > 5) baseLevel *= 0.2;
  else if (precipMm > 1) baseLevel *= 0.5;

  if (windSpeedKmH > 25) baseLevel *= 1.5;
  else if (windSpeedKmH > 15) baseLevel *= 1.2;
  else if (windSpeedKmH < 3) baseLevel *= 0.6;

  if (relativeHumidity > 85) baseLevel *= 0.4;
  else if (relativeHumidity > 70) baseLevel *= 0.7;

  if (cloudCover !== undefined && cloudCover > 80) baseLevel *= 0.6;

  return Math.round(Math.max(0, Math.min(150, baseLevel)));
}

function determineRisk(estimatedLevel: number, th: { low: number; medium: number; high: number }): string {
  if (estimatedLevel >= th.high) return "Alto";
  if (estimatedLevel >= th.medium) return "Medio";
  return "Basso";
}

function getRecommendations(maxRisk: string): string {
  if (maxRisk === "Alto") {
    return "Evitare attività outdoor nelle ore calde (10-16). Antistaminici profilattici. Chiudere finestre, lavarsi dopo essere stati fuori.";
  }
  if (maxRisk === "Medio") {
    return "Limitare tempo all'aperto se sensibili. Doccia e cambio vestiti al rientro.";
  }
  return "Condizioni favorevoli per chi soffre di allergie.";
}

export async function handlePollenRequest({
  latitude,
  longitude,
  tempC,
  relativeHumidity,
  windSpeedKmH,
  precipMm,
  cloudCover,
}: {
  latitude: number;
  longitude: number;
  tempC: number;
  relativeHumidity: number;
  windSpeedKmH: number;
  precipMm: number;
  cloudCover?: number;
}) {
  const start = Date.now();
  const month = new Date().getMonth() + 1;
  const isNord = latitude > 44.0;

  const activeAllergens: Array<{ pollen: string; estimatedLevel: number; risk: string; isPeak: boolean }> = [];
  for (let i = 0; i < POLLEN_CALENDAR.length; i++) {
    const item = POLLEN_CALENDAR[i];
    const pollen = item.pollen;
    const seasons = item;
    const activeMonths = isNord ? seasons.nord : seasons.centro_sud;
    if (!activeMonths.has(month)) continue;

    const estimatedLevel = calculateBaseLevel(tempC, relativeHumidity, windSpeedKmH, precipMm, cloudCover);
    const th = THRESHOLDS[pollen] ?? { low: 10, medium: 30, high: 50 };
    const risk = determineRisk(estimatedLevel, th);

    activeAllergens.push({
      pollen,
      estimatedLevel,
      risk,
      isPeak: isNord ? seasons.nordPeak : seasons.centro_sudPeak,
    });
  }

  activeAllergens.sort((a, b) => b.estimatedLevel - a.estimatedLevel);
  const maxRisk = activeAllergens.some((a) => a.risk === "Alto")
    ? "Alto"
    : activeAllergens.some((a) => a.risk === "Medio")
      ? "Medio"
      : "Basso";

  return toToolResult({
    ok: true,
    url: "mcp://pollen",
    status: 200,
    data: {
      location: { latitude, longitude, zona: isNord ? "Nord Italia" : "Centro-Sud Italia" },
      mese: month,
      condizioniMeteo: { tempC, relativeHumidity, windSpeedKmH, precipMm },
      overallRisk: maxRisk,
      allergeniAttivi: activeAllergens,
      raccomandazioni: getRecommendations(maxRisk),
    },
    elapsedMs: Date.now() - start,
  });
}

// --- POLLEN FORECAST TOOL ---------------------------------------------------
export function registerPollen(server: McpServer) {
  server.registerTool(
    "meteo_pollen",
    {
      title: "Pollen Forecast Italy",
      description:
        "Estimate pollen levels for Italian allergenic plants based on season, weather conditions (T, humidity, wind, rain), and AIA thresholds. Returns active allergens, risk level, and recommendations.",
      inputSchema: {
        latitude: z.coerce.number().min(-90).max(90).describe("Latitude"),
        longitude: z.coerce.number().min(-180).max(180).describe("Longitude"),
        tempC: z.coerce.number().describe("Current temperature in °C"),
        relativeHumidity: z.coerce.number().min(0).max(100).describe("Relative humidity in %"),
        windSpeedKmH: z.coerce.number().min(0).describe("Wind speed in km/h"),
        precipMm: z.coerce.number().min(0).default(0).describe("Precipitation in last 24h in mm"),
        cloudCover: z.coerce.number().min(0).max(100).optional().describe("Cloud cover in %"),
      },
      outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    handlePollenRequest,
  );
}
