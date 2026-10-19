import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toToolResult, ApiResult } from "./http.js";
import { normalizeModelId } from "./models.js";

// --- HELPER FUNCTIONS -------------------------------------------------------

export function getWeights(macroarea: string): Record<string, number> {
  const weights: Record<string, Record<string, number>> = {
    nord_ovest: {
      icon_d2: 1.4,
      ecmwf_ifs025: 1.3,
      meteoswiss_icon_seamless: 1.3,
      italia_meteo_arpae_icon_2i: 1.2,
      icon_seamless: 1.0,
      arome_france: 0.9,
      gfs_seamless: 0.7,
    },
    nord_est: {
      italia_meteo_arpae_icon_2i: 1.5,
      icon_d2: 1.4,
      ecmwf_ifs025: 1.2,
      meteoswiss_icon_seamless: 1.2,
      geosphere_seamless: 1.1,
      icon_seamless: 1.0,
      gfs_seamless: 0.7,
    },
    centro_nord: {
      italia_meteo_arpae_icon_2i: 1.5,
      ecmwf_ifs025: 1.3,
      icon_eu: 1.1,
      icon_seamless: 1.0,
      meteofrance_seamless: 0.9,
      gfs_seamless: 0.7,
    },
    centro: {
      ecmwf_ifs025: 1.5,
      meteofrance_seamless: 1.2,
      icon_seamless: 1.1,
      arpege_europe: 1.0,
      icon_eu: 1.0,
      gfs_seamless: 0.8,
    },
    sud: {
      ecmwf_ifs025: 1.5,
      ecmwf_aifs025: 1.2,
      arpege_europe: 1.2,
      gfs_seamless: 1.0,
      icon_seamless: 0.9,
      meteofrance_seamless: 0.9,
    },
    sicilia: {
      ecmwf_ifs025: 1.6,
      ecmwf_aifs025: 1.3,
      arpege_europe: 1.2,
      gfs_seamless: 1.0,
      meteofrance_seamless: 0.8,
    },
    sardegna: {
      ecmwf_ifs025: 1.5,
      ecmwf_aifs025: 1.3,
      meteofrance_seamless: 1.2,
      arpege_europe: 1.0,
      gfs_seamless: 0.9,
    },
    costa_adriatica: {
      italia_meteo_arpae_icon_2i: 1.4,
      icon_d2: 1.3,
      ecmwf_ifs025: 1.2,
      knmi_seamless: 1.1,
      icon_seamless: 1.0,
      gfs_seamless: 0.8,
    },
    alpi: {
      icon_d2: 1.5,
      meteoswiss_icon_seamless: 1.4,
      ecmwf_ifs025: 1.2,
      geosphere_seamless: 1.2,
      italia_meteo_arpae_icon_2i: 1.1,
      icon_seamless: 0.9,
    },
    appennino: {
      ecmwf_ifs025: 1.4,
      icon_eu: 1.2,
      italia_meteo_arpae_icon_2i: 1.0,
      icon_seamless: 1.0,
      meteofrance_seamless: 0.9,
      gfs_seamless: 0.8,
    },
  };

  const rawWeights = weights[macroarea] ?? {};
  const matchedWeights: Record<string, number> = {};
  for (const [model, w] of Object.entries(rawWeights)) {
    matchedWeights[normalizeModelId(model)] = w;
  }
  return matchedWeights;
}

export function getBiases(
  modelId?: string,
): Array<{ model: string; zone: string; bias: string; entity: string; note: string }> {
  const biases = [
    {
      model: "italia_meteo_arpae_icon_2i",
      zone: "Versante adriatico",
      bias: "Anticipa precipitazioni",
      entity: "1-3h",
      note: "Inizia a piovere prima di quanto previsto",
    },
    {
      model: "italia_meteo_arpae_icon_2i",
      zone: "Prealpi venete, Appennino emiliano",
      bias: "Sovrastima pioggia orografica",
      entity: "+20-40%",
      note: "Su flussi da S/SW contro rilievi",
    },
    {
      model: "italia_meteo_arpae_icon_2i",
      zone: "Trieste",
      bias: "Sottostima Bora",
      entity: "-10-20 km/h raffica",
      note: "Tende a smorzare i picchi di raffica",
    },
    {
      model: "italia_meteo_arpae_icon_2i",
      zone: "Pianura Padana",
      bias: "Eccellente precisione nebbia padana",
      entity: "Migliore in assoluto",
      note: "Cattura perfettamente l'inversione termica",
    },
    {
      model: "ecmwf_ifs025",
      zone: "Tutto il territorio",
      bias: "Tende a smussare precipitazioni intense",
      entity: "-10-20% sui picchi",
      note: "Eccelle nelle tendenze ma sottostima i picchi convettivi estremi",
    },
    {
      model: "ecmwf_ifs025",
      zone: "Centro-Sud",
      bias: "Anticipa ondate di calore",
      entity: "12-24h",
      note: "Individua le ondate prima degli altri modelli",
    },
    {
      model: "icon_d2",
      zone: "Coste e valli alpine",
      bias: "Sovrastima raffiche di vento",
      entity: "+5-15 km/h",
      note: "Troppo generoso nelle raffiche in terreno complesso",
    },
    {
      model: "icon_d2",
      zone: "Pianura Padana, Prealpi",
      bias: "Eccellente temporali convettivi",
      entity: "Altissima precisione",
      note: "Migliore risoluzione per celle temporalesche",
    },
    {
      model: "gfs_seamless",
      zone: "Sud Italia, Sicilia",
      bias: "Sovrastima scirocco",
      entity: "+10-20 km/h",
      note: "Tende a esagerare l'intensità dello scirocco",
    },
    {
      model: "gfs_seamless",
      zone: "Liguria, Calabria tirrenica",
      bias: "Sottostima precipitazioni orografiche",
      entity: "-20-30%",
      note: "Risoluzione insufficiente per coste ripide",
    },
    {
      model: "gfs_seamless",
      zone: "Centro-Sud",
      bias: "Caldo eccessivo in estate",
      entity: "+1-2°C T max",
      note: "Bias caldo sistematico in estate al Sud",
    },
  ];

  const normalizedModelId = modelId ? normalizeModelId(modelId) : undefined;
  if (normalizedModelId) {
    return biases.filter((b) => normalizeModelId(b.model).includes(normalizedModelId));
  }
  return biases;
}

export function getUhiCorrection(cityName?: string, cloudCover?: number, windSpeedKmH?: number) {
  const uhiMatrix: Record<string, { deltaTMax: number; deltaTMin: number; note: string }> = {
    milano: { deltaTMax: 0.5, deltaTMin: 2.5, note: "Massimo effetto in estate con calma di vento" },
    roma: { deltaTMax: 1.0, deltaTMin: 2.0, note: "Effetto mitigato dal Ponentino in periferia" },
    torino: { deltaTMax: 0.5, deltaTMin: 2.0, note: "Ristagno termico in inverno e estate" },
    napoli: { deltaTMax: 0.5, deltaTMin: 1.5, note: "Effetto mitigato dalla brezza di mare" },
    bologna: { deltaTMax: 1.0, deltaTMin: 2.0, note: "Particolarmente intenso in estate" },
    firenze: { deltaTMax: 1.0, deltaTMin: 2.5, note: "Effetto conca amplifica l'accumulo" },
    bari: { deltaTMax: 1.0, deltaTMin: 4.0, note: "UHI intensa in estate, mitigata in costa" },
    palermo: { deltaTMax: 1.0, deltaTMin: 2.5, note: "Effetto amplificato da orografia (conca)" },
  };

  if (!cityName) return null;

  const uhiKey = cityName.toLowerCase().trim();
  const uhi = uhiMatrix[uhiKey];
  if (!uhi) return null;

  const isUhiMax = (cloudCover === undefined || cloudCover < 20) && (windSpeedKmH === undefined || windSpeedKmH < 5);
  return {
    cityName,
    deltaTMax: uhi.deltaTMax,
    deltaTMin: uhi.deltaTMin,
    conditionsMet: isUhiMax,
    appliedDeltaMin: isUhiMax ? uhi.deltaTMin : 0,
    note:
      uhi.note +
      (isUhiMax
        ? " (CONDIZIONI CORREZIONE UHI SODDISFATTE: cielo sereno e vento debole)"
        : " (Condizioni non ottimali per massimo UHI)"),
  };
}

export async function handleModelTuning({
  macroarea,
  cityName,
  cloudCover,
  windSpeedKmH,
  modelId,
}: {
  macroarea: string;
  cityName?: string;
  cloudCover?: number;
  windSpeedKmH?: number;
  modelId?: string;
}) {
  const start = Date.now();

  const matchedWeights = getWeights(macroarea);
  const filteredBiases = getBiases(modelId);
  const uhiApplied = getUhiCorrection(cityName, cloudCover, windSpeedKmH);

  const res: ApiResult = {
    ok: true,
    url: "mcp://model_tuning",
    status: 200,
    data: {
      macroarea,
      weights: matchedWeights,
      biases: filteredBiases,
      uhiCorrection: uhiApplied,
      dynamicWeightingScenarios: {
        convective:
          "Se CAPE > 500 o weather_code 80-99, aumenta peso (+0.3) di icon_d2, arome_france, italia_meteo_arpae_icon_2i; riduci gfs_seamless, ecmwf_ifs025.",
        frontal: "Se pioggia diffusa, aumenta peso (+0.3) di ecmwf_ifs025, arpege_europe.",
        fog: "Se nebbia padana, aumenta peso (+0.4) di italia_meteo_arpae_icon_2i; riduci gfs_seamless (-0.3).",
        orographic_wind:
          "Se Bora/Foehn, aumenta peso (+0.3) di icon_d2, meteoswiss_icon_seamless; riduci ecmwf_ifs025 (-0.2).",
        snow: "Se nevicate, aumenta peso (+0.4) di icon_d2, meteoswiss_icon_seamless, geosphere_seamless; riduci gfs_seamless (-0.2).",
      },
    },
    elapsedMs: Date.now() - start,
  };
  return toToolResult(res);
}

// --- 4. MODEL TUNING & BIASES TOOL ------------------------------------------

export function registerModelTuning(server: McpServer) {
  server.registerTool(
    "meteo_model_tuning",
    {
      title: "Model Biases, Weights & UHI Correction",
      description:
        "Retrieve model weights for consensus based on macroarea, fetch systematic model biases, and apply UHI (Urban Heat Island) corrections for major Italian cities.",
      inputSchema: {
        macroarea: z
          .enum([
            "nord_ovest",
            "nord_est",
            "centro_nord",
            "centro",
            "sud",
            "sicilia",
            "sardegna",
            "costa_adriatica",
            "alpi",
            "appennino",
          ])
          .describe("Italian geographical macroarea"),
        cityName: z
          .string()
          .optional()
          .describe(
            "Filter/Apply UHI correction for a city (Milano, Roma, Torino, Napoli, Bologna, Firenze, Bari, Palermo)",
          ),
        cloudCover: z.coerce.number().min(0).max(100).optional().describe("Cloud cover (%) to evaluate UHI conditions"),
        windSpeedKmH: z.coerce.number().min(0).optional().describe("Wind speed (km/h) to evaluate UHI conditions"),
        modelId: z
          .string()
          .optional()
          .describe(
            "Filter biases for a specific model (e.g. ecmwf_ifs025, icon_d2, italia_meteo_arpae_icon_2i, gfs_seamless)",
          ),
      },
      outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    handleModelTuning,
  );
}
