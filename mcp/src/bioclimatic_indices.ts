import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toToolResult, ApiResult } from "./http.js";
import { evaluateUseCaseThresholds, type BioclimaticIndicesArgs } from "./bioclimatic_usecases.js";

export type { BioclimaticIndicesArgs };

// --- 2. BIOCLIMATIC INDICES TOOL --------------------------------------------

function calculateHeatIndex(tempC: number, relativeHumidity?: number) {
  if (tempC < 27 || relativeHumidity === undefined) return undefined;
  const t = tempC * 1.8 + 32;
  const rh = relativeHumidity;
  let hiF = 0.5 * (t + 61.0 + (t - 68.0) * 1.2 + rh * 0.094);
  if (hiF >= 80) {
    hiF =
      -42.379 +
      2.04901523 * t +
      10.14333127 * rh -
      0.22475541 * t * rh -
      0.00683783 * t * t -
      0.05481717 * rh * rh +
      0.00122874 * t * t * rh +
      0.00085282 * t * rh * rh -
      0.00000199 * t * t * rh * rh;
  }
  const hiC = (hiF - 32) / 1.8;
  let category = "Normale";
  if (hiC >= 27 && hiC < 32) category = "Cautela (Affaticamento)";
  else if (hiC >= 32 && hiC < 41) category = "Estrema Cautela (Crampi/Insolazione)";
  else if (hiC >= 41 && hiC < 54) category = "Pericolo (Colpo di calore)";
  else if (hiC >= 54) category = "Estremo Pericolo (Colpo di calore imminente)";

  return {
    valueC: Math.round(hiC * 10) / 10,
    valueF: Math.round(hiF * 10) / 10,
    category,
  };
}

function calculateTHI(tempC: number, relativeHumidity?: number) {
  if (relativeHumidity === undefined) return undefined;
  const thi = 1.8 * tempC + 32 - (0.55 - 0.0055 * relativeHumidity) * (1.8 * tempC - 26);
  let thiStatus = "Nessuno stress";
  if (thi >= 68 && thi < 72) thiStatus = "Stress Lieve (inizio disagio)";
  else if (thi >= 72 && thi < 79) thiStatus = "Stress Moderato";
  else if (thi >= 79 && thi < 90) thiStatus = "Stress Grave";
  else if (thi >= 90) thiStatus = "Emergenza";
  return { value: Math.round(thi * 10) / 10, status: thiStatus };
}

function calculateWindChill(tempC: number, windSpeedKmH?: number) {
  if (tempC > 10 || windSpeedKmH === undefined || windSpeedKmH <= 4.8) return undefined;
  const t = tempC;
  const v = windSpeedKmH;
  const wc = 13.12 + 0.6215 * t - 11.37 * Math.pow(v, 0.16) + 0.3965 * t * Math.pow(v, 0.16);
  let wcStatus = "Freddo moderato";
  if (wc < 0 && wc >= -10) wcStatus = "Freddo intenso";
  else if (wc < -10 && wc >= -25) wcStatus = "Rischio congelamento/ipotermia graduale";
  else if (wc < -25) wcStatus = "Rischio congelamento rapido (pericolo estremo)";
  return {
    valueC: Math.round(wc * 10) / 10,
    status: wcStatus,
  };
}

function calculateGDD(gddBase: number, tempMinC?: number, tempMaxC?: number) {
  if (tempMinC === undefined || tempMaxC === undefined) return undefined;
  const avgT = (tempMinC + tempMaxC) / 2;
  const gdd = Math.max(avgT - gddBase, 0);
  return {
    base: gddBase,
    value: Math.round(gdd * 10) / 10,
    note: `Growing Degree Days accumulati oggi con base ${gddBase}°C`,
  };
}

function calculateWaterBalance(precip7dMm?: number, et07dMm?: number) {
  if (precip7dMm === undefined || et07dMm === undefined) return undefined;
  const bilancio = precip7dMm - et07dMm;
  let status = "Equilibrio";
  let impact = "Condizioni ottimali";
  if (bilancio > 20) {
    status = "Surplus Idrico";
    impact = "Terreno saturo, rischio ristagni, stop irrigazione";
  } else if (bilancio < -10 && bilancio >= -30) {
    status = "Deficit Moderato";
    impact = "Inizio stress idrico per orticole e prati";
  } else if (bilancio < -30) {
    status = "Stress Idrico Severo";
    impact = "Irrigazione di soccorso necessaria, rapido disseccamento";
  }
  return {
    valueMm: Math.round(bilancio * 10) / 10,
    status,
    impact,
    precip7dMm,
    et07dMm,
  };
}

function calculateSoilMoisture(soilMoisture0to1cm?: number) {
  if (soilMoisture0to1cm === undefined) return undefined;
  let moistureStatus = "Moderata";
  if (soilMoisture0to1cm < 0.15) moistureStatus = "Molto secco (punto di appassimento)";
  else if (soilMoisture0to1cm > 0.35) moistureStatus = "Molto umido / saturo";
  return {
    value: soilMoisture0to1cm,
    status: moistureStatus,
  };
}

function calculateFireRisk(
  tempC: number,
  relativeHumidity?: number,
  windSpeedKmH?: number,
  soilMoisture0to1cm?: number,
) {
  if (tempC === undefined || relativeHumidity === undefined) return { vpd: undefined, risk: undefined };
  const es = 0.61078 * Math.exp((17.27 * tempC) / (tempC + 237.3)); // kPa
  const ea = es * (relativeHumidity / 100); // kPa
  const vpd = Math.max(0, es - ea); // kPa

  const vaporPressureDeficit = {
    saturatedVaporPressureKpa: Math.round(es * 100) / 100,
    actualVaporPressureKpa: Math.round(ea * 100) / 100,
    vpdKpa: Math.round(vpd * 100) / 100,
  };

  const ws = windSpeedKmH ?? 0;
  const sm = soilMoisture0to1cm ?? 0.25;

  let fireRisk = "BASSO";
  let fireFlag = "Rischio trascurabile";

  if (vpd > 2.0 && ws > 35 && sm < 0.15) {
    fireRisk = "ESTREMO";
    fireFlag = "⚠️ Pericolo Incendi Estremo (Red Flag) — propagazione incontrollabile!";
  } else if (vpd > 1.5 && ws > 20) {
    fireRisk = "ALTO";
    fireFlag = "⚠️ Rischio Incendio Elevato — vegetazione altamente infiammabile.";
  } else if (vpd > 1.0 || sm < 0.2) {
    fireRisk = "MEDIO";
    fireFlag = "Attenzione: vegetazione secca, favorevole a inneschi locali.";
  }

  const nimbusFireIntelligence = {
    riskLevel: fireRisk,
    flag: fireFlag,
    vpdKpa: Math.round(vpd * 100) / 100,
    soilMoisture: sm,
    windSpeedKmH: ws,
  };

  return { vpd: vaporPressureDeficit, risk: nimbusFireIntelligence };
}

function calculateSnowLine(
  freezingLevelHeightM?: number,
  precipIntensityMmH?: number,
  isNarrowValley?: boolean,
  relativeHumidity?: number,
) {
  if (freezingLevelHeightM === undefined) return undefined;
  const baseOffset = 300;
  let intensityAdj = 0;
  let valleyAdj = 0;
  let humidityAdj = 0;

  if (precipIntensityMmH !== undefined) {
    if (precipIntensityMmH < 2) {
      intensityAdj = -100; // Total offset is 200m
    } else if (precipIntensityMmH >= 2 && precipIntensityMmH <= 5) {
      intensityAdj = 100; // Total offset is 400m
    } else if (precipIntensityMmH > 5 && precipIntensityMmH <= 10) {
      intensityAdj = 300; // Total offset is 600m
    } else if (precipIntensityMmH > 10) {
      intensityAdj = 500; // Total offset is 800m (omotermia grave)
    }
  }

  if (isNarrowValley === true) {
    valleyAdj = 150; // extra descent in narrow valleys
  }

  if (relativeHumidity !== undefined) {
    if (relativeHumidity < 70) {
      humidityAdj = 100; // dry air, snow falls lower relative to ZT
    } else if (relativeHumidity > 90) {
      humidityAdj = -100; // humid air, snow melts faster
    }
  }

  const totalOffset = baseOffset + intensityAdj + valleyAdj + humidityAdj;
  const snowLine = Math.max(0, freezingLevelHeightM - totalOffset);

  return {
    calculatedSnowLineM: Math.round(snowLine),
    freezingLevelHeightM,
    totalOffsetM: totalOffset,
    breakdown: {
      baseOffsetM: baseOffset,
      intensityAdjustmentM: intensityAdj,
      valleyAdjustmentM: valleyAdj,
      humidityAdjustmentM: humidityAdj,
    },
    formulaUsed: "Quota Neve = Zero_Termico - (300m + Correttivo_Intensità + Correttivo_Valle + Correttivo_Umidità)",
  };
}

export async function handleBioclimaticIndices(args: BioclimaticIndicesArgs) {
  const {
    tempC,
    relativeHumidity,
    windSpeedKmH,
    tempMinC,
    tempMaxC,
    gddBase,
    precip7dMm,
    et07dMm,
    soilMoisture0to1cm,
    freezingLevelHeightM,
    precipIntensityMmH,
    isNarrowValley,
  } = args;

  const start = Date.now();
  const indices: Record<string, unknown> = {};

  const heatIndex = calculateHeatIndex(tempC, relativeHumidity);
  if (heatIndex) indices.heatIndex = heatIndex;

  const thi = calculateTHI(tempC, relativeHumidity);
  if (thi) indices.thi = thi;

  const windChill = calculateWindChill(tempC, windSpeedKmH);
  if (windChill) indices.windChill = windChill;

  const gdd = calculateGDD(gddBase, tempMinC, tempMaxC);
  if (gdd) indices.gdd = gdd;

  const waterBalance = calculateWaterBalance(precip7dMm, et07dMm);
  if (waterBalance) indices.waterBalance = waterBalance;

  const soilMoisture = calculateSoilMoisture(soilMoisture0to1cm);
  if (soilMoisture) indices.soilMoisture = soilMoisture;

  const thresholdsAndIndices = evaluateUseCaseThresholds(args);
  const thresholds = thresholdsAndIndices.thresholds;
  Object.assign(indices, thresholdsAndIndices.indices);

  const fireIntelligence = calculateFireRisk(tempC, relativeHumidity, windSpeedKmH, soilMoisture0to1cm);
  if (fireIntelligence.vpd) indices.vaporPressureDeficit = fireIntelligence.vpd;
  if (fireIntelligence.risk) indices.nimbusFireIntelligence = fireIntelligence.risk;

  const snowLine = calculateSnowLine(freezingLevelHeightM, precipIntensityMmH, isNarrowValley, relativeHumidity);
  if (snowLine) indices.snowLineNimbus = snowLine;

  const res: ApiResult = {
    ok: true,
    url: "mcp://bioclimatic_indices",
    status: 200,
    data: {
      indices,
      thresholds,
    },
    elapsedMs: Date.now() - start,
  };
  return toToolResult(res);
}

export function registerBioclimaticIndices(server: McpServer) {
  server.registerTool(
    "meteo_bioclimatic_indices",
    {
      title: "Indici Bioclimatici e Soglie Agricole",
      description:
        "Indici e soglie per contesti specifici, da usare dopo meteo_brief: salute/comfort (Heat Index, Wind Chill, THI bestiame), agricoltura (GDD, bilancio idrico, gelate, peronospora vite, olivo, api), montagna (quota neve, Ski Index, AINEVA), mare/turismo (Beach Index), energia (eolico, solare), rischio incendi (VPD, Nimbus Fire). Passa temperatura, umidità, vento e gli altri valori presi dal brief.",
      inputSchema: {
        tempC: z.coerce.number().describe("Air temperature in °C"),
        relativeHumidity: z.coerce.number().min(0).max(100).optional().describe("Relative humidity in %"),
        windSpeedKmH: z.coerce.number().min(0).optional().describe("Wind speed in km/h"),
        tempMinC: z.coerce.number().optional().describe("Minimum air temperature in °C"),
        tempMaxC: z.coerce.number().optional().describe("Maximum air temperature in °C"),
        gddBase: z.coerce.number().default(10).describe("Base temperature for GDD calculation, default 10°C"),
        precip7dMm: z.coerce.number().min(0).optional().describe("7-day accumulated precipitation in mm"),
        et07dMm: z.coerce.number().min(0).optional().describe("7-day FAO-ET0 evapotranspiration in mm"),
        soilMoisture0to1cm: z.coerce.number().min(0).max(1).optional().describe("Soil moisture (0-1cm) in m³/m³"),
        soilTemp6cm: z.coerce.number().optional().describe("Soil temperature at 6cm depth in °C"),
        useCase: z
          .enum([
            "agricoltura",
            "apicoltura",
            "vite",
            "olivo",
            "solare",
            "eolico",
            "montagna_sci",
            "spiaggia_mare",
            "energia_fv",
            "energia_eolico",
          ])
          .optional()
          .describe("Target use case for threshold checks"),
        seaSurfaceTempC: z.coerce.number().optional().describe("Sea Surface Temperature in °C (for beach/marine)"),
        uvIndex: z.coerce.number().min(0).optional().describe("UV Index max value"),
        snowfallSumCm: z.coerce.number().min(0).optional().describe("Fresh snowfall sum in cm (for ski)"),
        snowDepthCm: z.coerce.number().min(0).optional().describe("Snow depth in cm (for ski)"),
        freezingLevelHeightM: z.coerce.number().optional().describe("Freezing level (Zero Termico) height in meters"),
        precipIntensityMmH: z.coerce.number().optional().describe("Precipitation intensity in mm/h or cm/h"),
        isNarrowValley: z.boolean().optional().describe("Whether the location is in a narrow alpine/apennine valley"),
        cloudCover: z.coerce.number().min(0).max(100).optional().describe("Cloud cover in % (for energy use cases)"),
      },
      outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    handleBioclimaticIndices,
  );
}
