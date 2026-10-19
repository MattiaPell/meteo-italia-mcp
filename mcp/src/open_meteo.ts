import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiGet, toToolResult, openMeteoCommon, latLon, validateApiData } from "./http.js";
import { normalizeModelId } from "./reference_tools.js";

const geocodeSchema = z.object({
  results: z
    .array(
      z.object({
        name: z.string(),
        country_code: z.string().optional(),
        admin1: z.union([z.string(), z.null()]).optional(),
        admin2: z.union([z.string(), z.null()]).optional(),
        latitude: z.number(),
        longitude: z.number(),
        elevation: z.number().optional(),
      }),
    )
    .optional(),
});

const csv = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

async function fetchOpenMeteo(url: string, args: Record<string, any>) {
  const params: Record<string, any> = { ...args };
  if (params.models && typeof params.models === "string") params.models = csv(params.models).map(normalizeModelId);
  if (params.hourly && typeof params.hourly === "string") params.hourly = csv(params.hourly);
  if (params.daily && typeof params.daily === "string") params.daily = csv(params.daily);
  if (params.current && typeof params.current === "string") params.current = csv(params.current);
  if (params.seasonal && typeof params.seasonal === "string") params.seasonal = csv(params.seasonal);
  if (params.ensemble === true) params.ensemble = "true";

  // Clean up undefined values from args explicitly since they were passed directly
  for (const key of Object.keys(params)) {
    if (params[key] === undefined) {
      delete params[key];
    }
  }

  const r = await apiGet(url, params);
  return toToolResult(r);
}

export async function handleOpenMeteoGeocode({ name, count, language }: GeocodeParams) {
  const r = await apiGet("https://geocoding-api.open-meteo.com/v1/search", {
    name,
    count,
    language,
    format: "json",
  });
  if (!r.ok) return toToolResult(r);
  const parsed = validateApiData(r, geocodeSchema, "Open-Meteo Geocoding");
  const results = parsed.results ?? [];
  const itResults = results.filter((x: any) => x.country_code === "IT");
  const chosen = itResults[0] ?? null;
  const candidates = itResults.map((x: any) => ({
    name: x.name,
    admin1: x.admin1,
    admin2: x.admin2,
    lat: x.latitude,
    lon: x.longitude,
    elevation: x.elevation,
  }));
  const nonIt = results.find((x: any) => x.country_code !== "IT");
  const enriched = {
    ...r,
    data: {
      countryFiltered: itResults.length > 0,
      chosen,
      needsDisambiguation: itResults.length > 3,
      candidates,
      fallbackSuggestion: chosen === null && nonIt ? `${nonIt.name} (${nonIt.admin1 ?? nonIt.country_code})` : null,
      raw: r.data,
    },
  };
  return toToolResult(enriched);
}

const CORE_HOURLY = [
  "temperature_2m",
  "precipitation",
  "wind_speed_10m",
  "wind_gusts_10m",
  "weather_code",
  "cloud_cover",
  "precipitation_probability",
  "cape",
];

const CORE_DAILY = [
  "temperature_2m_max",
  "temperature_2m_min",
  "apparent_temperature_max",
  "apparent_temperature_min",
  "precipitation_sum",
  "snowfall_sum",
  "precipitation_probability_max",
  "wind_speed_10m_max",
  "wind_gusts_10m_max",
  "weather_code",
  "uv_index_max",
  "et0_fao_evapotranspiration",
];

const LEVEL_3_HOURLY = [
  "temperature_2m",
  "precipitation",
  "weather_code",
  "cape",
  "wind_gusts_10m",
  "wind_speed_80m",
  "wind_direction_80m",
  "wind_speed_120m",
  "wind_direction_120m",
  "shortwave_radiation",
  "direct_radiation",
  "diffuse_radiation",
  "direct_normal_irradiance",
  "terrestrial_radiation",
  "soil_temperature_6cm",
  "soil_temperature_18cm",
  "soil_moisture_1_to_3cm",
  "wet_bulb_temperature_2m",
  "geopotential_height_1000hPa",
  "geopotential_height_925hPa",
  "geopotential_height_700hPa",
];

const LEVEL_2_HOURLY = [
  ...CORE_HOURLY,
  "temperature_850hPa",
  "temperature_500hPa",
  "lifted_index",
  "convective_inhibition",
  "freezing_level_height",
  "visibility",
  "boundary_layer_height",
];

function checkTriggers(l1Data: any): boolean {
  const codes = (l1Data?.hourly?.weather_code ?? []).flatMap((a: any) => (Array.isArray(a) ? a : [a]));
  const capes = (l1Data?.hourly?.cape ?? []).flatMap((a: any) => (Array.isArray(a) ? a : [a]));
  const precs = (l1Data?.hourly?.precipitation ?? []).flatMap((a: any) => (Array.isArray(a) ? a : [a]));
  const winds = (l1Data?.hourly?.wind_speed_10m ?? []).flatMap((a: any) => (Array.isArray(a) ? a : [a]));
  return (
    codes.some((c: number) => c >= 80 && c <= 99) ||
    capes.some((c: number) => c > 500) ||
    precs.some((p: number) => p > 10) ||
    winds.some((w: number) => w > 50)
  );
}
export async function handleOpenMeteoForecast({
  latitude,
  longitude,
  models,
  hourly,
  daily,
  current,
  timezone,
  past_days,
  forecast_days,
  level,
}: ForecastParams) {
  const chosenModels = models ? csv(models).map(normalizeModelId) : undefined;

  const l1 = await apiGet("https://api.open-meteo.com/v1/forecast", {
    latitude,
    longitude,
    models: chosenModels,
    hourly: hourly ? csv(hourly) : CORE_HOURLY,
    daily: daily ? csv(daily) : CORE_DAILY,
    current: current ? csv(current) : undefined,
    timezone,
    past_days: past_days ?? 0,
    forecast_days: forecast_days ?? 7,
  });
  if (!l1.ok) return toToolResult(l1);

  const l1Data = l1.data as any;
  const triggered = checkTriggers(l1Data);

  let levelUsed: "1" | "2" | "3" = "1";
  let finalRes = l1;
  if (level === "3") {
    levelUsed = "3";
    finalRes = await apiGet("https://api.open-meteo.com/v1/forecast", {
      latitude,
      longitude,
      models: chosenModels,
      hourly: hourly ? csv(hourly) : LEVEL_3_HOURLY,
      daily: daily ? csv(daily) : CORE_DAILY,
      current: current ? csv(current) : undefined,
      timezone,
      past_days: past_days ?? 0,
      forecast_days: 16,
    });
  } else if (level === "2" || (level === "auto" && triggered)) {
    levelUsed = "2";
    finalRes = await apiGet("https://api.open-meteo.com/v1/forecast", {
      latitude,
      longitude,
      models: chosenModels,
      hourly: hourly ? csv(hourly) : LEVEL_2_HOURLY,
      daily: daily ? csv(daily) : CORE_DAILY,
      current: current ? csv(current) : undefined,
      timezone,
      past_days: 7,
      forecast_days: forecast_days ?? 7,
    });
  }

  const enriched = {
    ...finalRes,
    data: {
      levelUsed,
      triggerActivated: triggered,
      raw: finalRes.data,
    },
  };
  return toToolResult(enriched);
}

export async function handleOpenMeteoArchive({
  latitude,
  longitude,
  start_date,
  end_date,
  daily,
  hourly,
  timezone,
}: ArchiveParams) {
  return fetchOpenMeteo("https://archive-api.open-meteo.com/v1/archive", {
    latitude,
    longitude,
    start_date,
    end_date,
    daily,
    hourly,
    timezone,
  });
}

export async function handleOpenMeteoMarine({
  latitude,
  longitude,
  hourly,
  daily,
  timezone,
  past_days,
  forecast_days,
}: MarineParams) {
  return fetchOpenMeteo("https://marine-api.open-meteo.com/v1/marine", {
    latitude,
    longitude,
    hourly,
    daily,
    timezone,
    past_days,
    forecast_days,
  });
}

export async function handleOpenMeteoAirQuality({
  latitude,
  longitude,
  hourly,
  current,
  domains,
  timezone,
  past_days,
  forecast_days,
}: AirQualityParams) {
  return fetchOpenMeteo("https://air-quality-api.open-meteo.com/v1/air-quality", {
    latitude,
    longitude,
    hourly,
    current,
    domains,
    timezone,
    past_days,
    forecast_days,
  });
}

export async function handleOpenMeteoEnsemble({
  latitude,
  longitude,
  models,
  hourly,
  daily,
  timezone,
  past_days,
  forecast_days,
}: EnsembleParams) {
  return fetchOpenMeteo("https://ensemble-api.open-meteo.com/v1/ensemble", {
    latitude,
    longitude,
    models,
    hourly,
    daily,
    timezone,
    past_days,
    forecast_days,
  });
}

export async function handleOpenMeteoFlood({
  latitude,
  longitude,
  daily,
  model,
  ensemble,
  timezone,
  past_days,
  forecast_days,
}: FloodParams) {
  return fetchOpenMeteo("https://flood-api.open-meteo.com/v1/flood", {
    latitude,
    longitude,
    daily,
    model: model ?? undefined,
    ensemble,
    timezone,
    past_days,
    forecast_days,
  });
}

export async function handleOpenMeteoSeasonal({
  latitude,
  longitude,
  seasonal,
  models,
  temporal_resolution,
  timezone,
  past_days,
  forecast_days,
}: SeasonalParams) {
  return fetchOpenMeteo("https://seasonal-api.open-meteo.com/v1/seasonal", {
    latitude,
    longitude,
    seasonal,
    models,
    temporal_resolution,
    timezone,
    past_days,
    forecast_days,
  });
}

export const geocodeSchema = z.object({
  name: z.string().describe("City or place name to search"),
  count: z.coerce.number().int().min(1).max(50).default(10).describe("Max results"),
  language: z.string().default("it").describe("Response language"),
});
export type GeocodeParams = z.infer<typeof geocodeSchema>;

const GEOCODE_TOOL = {
  title: "Open-Meteo Geocoding",
  description:
    "Resolve a place name to coordinates. Returns results filtered to Italy when possible, with lat/lon, elevation and admin region. Use this before any forecast call.",
  inputSchema: geocodeSchema.shape,
  outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
};

export const forecastSchema = z.object({
  ...latLon,
  ...openMeteoCommon,
  models: z.string().optional().describe("Comma-separated model list, e.g. ecmwf_ifs025,icon_seamless,gfs_seamless"),
  hourly: z.string().optional().describe("Comma-separated hourly variables"),
  daily: z.string().optional().describe("Comma-separated daily variables"),
  current: z.string().optional().describe("Comma-separated current variables"),
  level: z
    .enum(["1", "2", "3", "auto"])
    .default("auto")
    .describe(
      "Fetch detail level: 1=core, 2=event-driven advanced, 3=use-case specialized, auto=decide from Level-1 triggers",
    ),
});
export type ForecastParams = z.infer<typeof forecastSchema>;

const FORECAST_TOOL = {
  title: "Open-Meteo Forecast",
  description:
    "Multi-model numerical forecast. Pass models (comma list), hourly variables, daily variables. Supports past_days and forecast_days. Core call for the skill's Step A.",
  inputSchema: forecastSchema.shape,
  outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
};

export const archiveSchema = z.object({
  ...latLon,
  start_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Start date YYYY-MM-DD"),
  end_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("End date YYYY-MM-DD"),
  daily: z.string().optional().describe("Comma-separated daily variables"),
  hourly: z.string().optional().describe("Comma-separated hourly variables"),
  timezone: z.string().default("Europe/Rome"),
});
export type ArchiveParams = z.infer<typeof archiveSchema>;

const ARCHIVE_TOOL = {
  title: "Open-Meteo Archive (ERA5)",
  description:
    "Historical reanalysis (ERA5) for climatology baselines. Provide start_date and end_date (YYYY-MM-DD). Used by skill Step B.",
  inputSchema: archiveSchema.shape,
  outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
};

export const marineSchema = z.object({
  ...latLon,
  ...openMeteoCommon,
  hourly: z.string().optional().describe("Comma-separated hourly marine variables"),
  daily: z.string().optional().describe("Comma-separated daily marine variables"),
});
export type MarineParams = z.infer<typeof marineSchema>;

const MARINE_TOOL = {
  title: "Open-Meteo Marine",
  description:
    "Marine weather: wave height/direction/period, SST. Activate for coastal/nautical use cases (skill Step F).",
  inputSchema: marineSchema.shape,
  outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
};

export const airQualitySchema = z.object({
  ...latLon,
  ...openMeteoCommon,
  hourly: z.string().optional().describe("Comma-separated hourly AQ variables"),
  current: z.string().optional().describe("Comma-separated current AQ variables"),
  domains: z.string().default("cams_europe").describe("Model domain, default cams_europe"),
});
export type AirQualityParams = z.infer<typeof airQualitySchema>;

const AIR_QUALITY_TOOL = {
  title: "Open-Meteo Air Quality (CAMS)",
  description:
    "European air quality (CAMS): PM10/PM2.5, NO2, O3, SO2, CO, dust, European AQI, pollen. Used by skill Step H.",
  inputSchema: airQualitySchema.shape,
  outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
};

export const ensembleSchema = z.object({
  ...latLon,
  ...openMeteoCommon,
  models: z.string().optional().describe("Comma-separated ensemble models"),
  hourly: z.string().optional().describe("Comma-separated hourly variables (include _spread vars)"),
  daily: z.string().optional().describe("Comma-separated daily variables"),
});
export type EnsembleParams = z.infer<typeof ensembleSchema>;

const ENSEMBLE_TOOL = {
  title: "Open-Meteo Ensemble",
  description:
    "Ensemble probabilistic forecasts with spread (sigma between members). Used by skill Step J for uncertainty.",
  inputSchema: ensembleSchema.shape,
  outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
};

export const floodSchema = z.object({
  ...latLon,
  ...openMeteoCommon,
  daily: z
    .string()
    .optional()
    .describe(
      "Comma-separated daily flood variables: river_discharge, river_discharge_mean, river_discharge_median, river_discharge_max, river_discharge_min, river_discharge_p25, river_discharge_p75",
    ),
  model: z
    .string()
    .optional()
    .describe(
      "Flood model (default: GloFAS v4 Seamless). Valid: seo_v4_forecast, seo_v4_consolidated, glofas_v3_seamless, glofas_v3_forecast, glofas_v3_consolidated",
    ),
  ensemble: z.boolean().default(false).describe("Set true to return all 50 ensemble members"),
});
export type FloodParams = z.infer<typeof floodSchema>;

const FLOOD_TOOL = {
  title: "Open-Meteo Flood (GloFAS)",
  description:
    "Simulated river discharge at 5 km resolution from 1984 up to 12 months forecast. Uses GloFAS v4. Fits Step G (risk idrogeologico). Tip: variare coordinate di ±0.1° per selezionare il corso d'acqua corretto.",
  inputSchema: floodSchema.shape,
  outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
};

export const seasonalSchema = z.object({
  ...latLon,
  ...openMeteoCommon,
  seasonal: z
    .string()
    .optional()
    .describe(
      "Comma-separated seasonal variables: temperature_2m, precipitation, pressure_msl, cloud_cover, soil_moisture_total, geopotential_height_500hPa, temperature_850hPa, soil_temperature_0_to_7cm, etc.",
    ),
  models: z.string().default("ecmwf_seasonal_seamless").describe("Seasonal model: ecmwf_seasonal_seamless (default)"),
  temporal_resolution: z.string().optional().describe("Time aggregation (default: hourly_6)"),
});
export type SeasonalParams = z.infer<typeof seasonalSchema>;

const SEASONAL_TOOL = {
  title: "Open-Meteo Seasonal (ECMWF, 7 mesi)",
  description:
    "Seasonal weather forecast up to 7 months ahead (ECMWF SEAS5). 6-hourly resolution. Variables: temperature_2m, precipitation, pressure_msl, cloud_cover, geopotential_height, soil moisture/temperature. Usato per outlook climatico Step K.",
  inputSchema: seasonalSchema.shape,
  outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
};

export function registerOpenMeteo(server: McpServer) {
  // --- Geocoding ---------------------------------------------------------
  server.registerTool("open_meteo_geocode", GEOCODE_TOOL, handleOpenMeteoGeocode);

  // --- Forecast (TIER 1, LIVELLI 1-3) -----------------------------------
  server.registerTool("open_meteo_forecast", FORECAST_TOOL, handleOpenMeteoForecast);

  // --- Archive / ERA5 climatology (Step B) ------------------------------
  server.registerTool("open_meteo_archive", ARCHIVE_TOOL, handleOpenMeteoArchive);

  // --- Marine (Step F) --------------------------------------------------
  server.registerTool("open_meteo_marine", MARINE_TOOL, handleOpenMeteoMarine);

  // --- Air Quality / CAMS (Step H) --------------------------------------
  server.registerTool("open_meteo_air_quality", AIR_QUALITY_TOOL, handleOpenMeteoAirQuality);

  // --- Ensemble (Step J) ------------------------------------------------
  server.registerTool("open_meteo_ensemble", ENSEMBLE_TOOL, handleOpenMeteoEnsemble);

  // --- Flood (GloFAS) ------------------------------------------------------
  server.registerTool("open_meteo_flood", FLOOD_TOOL, handleOpenMeteoFlood);

  // --- Seasonal (ECMWF, 7 mesi) --------------------------------------------
  server.registerTool("open_meteo_seasonal", SEASONAL_TOOL, handleOpenMeteoSeasonal);
}
