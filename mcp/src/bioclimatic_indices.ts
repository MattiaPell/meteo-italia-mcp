import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toToolResult, ApiResult } from "./http.js";

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

function evaluateAgricoltura(
  args: BioclimaticIndicesArgs,
  thresholds: Record<string, any>,
  _indices: Record<string, any>,
) {
  const { soilTemp6cm } = args;
  if (soilTemp6cm !== undefined) {
    thresholds.germination = {
      mais: soilTemp6cm >= 10 ? (soilTemp6cm >= 12 ? "Ottimale" : "Minima (germinazione lenta)") : "Arrestata (<10°C)",
      pomodoro: soilTemp6cm >= 12 ? (soilTemp6cm >= 15 ? "Ottimale" : "Minima") : "Insufficiente (<12°C)",
      barbabietola: soilTemp6cm >= 5 ? (soilTemp6cm >= 10 ? "Ottimale" : "Minima") : "Insufficiente (<5°C)",
      girasole: soilTemp6cm >= 8 ? (soilTemp6cm >= 10 ? "Ottimale" : "Minima") : "Insufficiente (<8°C)",
      value: soilTemp6cm,
    };
  }
}

function evaluateVite(args: BioclimaticIndicesArgs, thresholds: Record<string, any>, _indices: Record<string, any>) {
  const { tempMinC, precip7dMm, relativeHumidity } = args;
  // Regola dei Tre Dieci
  const hasT = tempMinC !== undefined && tempMinC > 10;
  const hasRain = precip7dMm !== undefined && precip7dMm >= 10;
  const wetnessProxy = relativeHumidity !== undefined && relativeHumidity > 90;
  thresholds.peronosporaRegolaTreDieci = {
    temperaturaSoddisfatta: hasT,
    pioggiaSoddisfatta: hasRain,
    bagnaturaFogliareProxy: wetnessProxy,
    rischioInfezionePrimaverile: hasT && hasRain ? "CRITICO (avvio infezioni primarie)" : "Basso",
    nota: "La regola richiede: T > 10°C, Tralcio > 10cm (da verificare in campo), Pioggia > 10mm in 24-48 ore.",
  };
  if (tempMinC !== undefined && tempMinC < -1) {
    thresholds.gelataTardivaVite = "PERICOLO GRAVE (T < -1°C dopo germogliamento)";
  }
}

function evaluateOlivo(args: BioclimaticIndicesArgs, thresholds: Record<string, any>, _indices: Record<string, any>) {
  const { tempC, tempMinC, relativeHumidity } = args;
  if (tempMinC !== undefined) {
    if (tempMinC < -10) {
      thresholds.freddoOlivo = "DANNI GRAVI AL LEGNO (T < -10°C)";
    } else if (tempMinC < -5) {
      thresholds.freddoOlivo = "Danni lievi a foglie/germogli (T < -5°C)";
    } else {
      thresholds.freddoOlivo = "Nessun danno da freddo";
    }
  }
  // Mosca dell'olivo
  const isFlyOptimal = tempC >= 22 && tempC <= 25;
  const isFlyLethal = tempC > 30 && relativeHumidity !== undefined && relativeHumidity < 30;
  const isFlyArrested = tempC > 35;
  thresholds.moscaOlivo = {
    stato: isFlyOptimal
      ? "Sviluppo ottimale (T 22-25°C)"
      : isFlyLethal
        ? "Alta mortalità uova/larve (T > 30°C + UR < 30%)"
        : isFlyArrested
          ? "Attività arrestata (T > 35°C)"
          : "Moderata",
  };
}

function evaluateApicoltura(
  args: BioclimaticIndicesArgs,
  thresholds: Record<string, any>,
  _indices: Record<string, any>,
) {
  const { tempC, tempMinC, relativeHumidity, windSpeedKmH } = args;
  let volo = "Assente (api nel glomere)";
  if (tempC >= 16 && tempC <= 25 && (windSpeedKmH === undefined || windSpeedKmH < 25)) {
    volo = "Attività ottimale di bottinatura";
  } else if (tempC >= 10 && tempC < 16) {
    volo = "Attività limitata";
  } else if (tempC > 35) {
    volo = "Attività ridotta (ventilazione alveare)";
  }
  if (windSpeedKmH !== undefined && windSpeedKmH >= 25) {
    volo += " ⚠️ Limitata da forte vento (>25 km/h)";
  }
  thresholds.voloApi = { stato: volo };

  thresholds.secrezioneNettarifera = {
    acacia:
      tempMinC !== undefined && tempMinC > 12 && relativeHumidity !== undefined && relativeHumidity > 60
        ? "Ottimale (notti miti >12°C + UR >60%)"
        : "Subottimale o bloccata",
    castagno:
      relativeHumidity !== undefined && relativeHumidity > 70
        ? "Favorita da clima umido"
        : "Ridotta da vento o siccità",
  };
}

function evaluateSolare(args: BioclimaticIndicesArgs, thresholds: Record<string, any>, _indices: Record<string, any>) {
  thresholds.solareNote = "DNI > 600 W/m² = ottimale, < 200 W/m² = basso. Rapporto direct/diffuse indica efficienza.";
}

function evaluateEolico(args: BioclimaticIndicesArgs, thresholds: Record<string, any>, _indices: Record<string, any>) {
  const { windSpeedKmH } = args;
  let eolicoVolo = "Fuori range operativo (nessuna produzione)";
  if (windSpeedKmH !== undefined) {
    const vMs = windSpeedKmH / 3.6;
    if (vMs >= 5 && vMs <= 25) eolicoVolo = "Operatività standard (buona produzione)";
    else if (vMs > 25) eolicoVolo = "CUT-OUT Preventivo (stop per sicurezza, vento >25 m/s / 90 km/h)";
    else if (vMs < 3) eolicoVolo = "CUT-IN Insufficiente (<3 m/s, nessuna produzione)";
    thresholds.eolicoStato = {
      windSpeedMs: Math.round(vMs * 10) / 10,
      stato: eolicoVolo,
    };
  }
}

function evaluateEnergiaFv(
  args: BioclimaticIndicesArgs,
  thresholds: Record<string, any>,
  indices: Record<string, any>,
) {
  const { tempC, cloudCover, uvIndex } = args;
  let fvScore = 100;
  const debugFlags: string[] = [];
  if (cloudCover !== undefined) {
    if (cloudCover > 80) {
      fvScore -= 60;
      debugFlags.push("cielo_coperto");
    } else if (cloudCover > 50) {
      fvScore -= 30;
      debugFlags.push("parzialmente_nuvoloso");
    } else if (cloudCover > 20) {
      fvScore -= 10;
      debugFlags.push("poche_nuvole");
    }
  }
  if (uvIndex !== undefined) {
    if (uvIndex < 2) {
      fvScore -= 20;
      debugFlags.push("uv_basso");
    } else if (uvIndex > 8) {
      fvScore += 5;
    }
  }
  if (tempC > 35) {
    fvScore -= 10;
    debugFlags.push("caldo_estremo_efficienza_ridotta");
  }
  indices.energiaFv = {
    score: Math.max(0, Math.min(100, fvScore)),
    stima: fvScore >= 70 ? "Produzione eccellente" : fvScore >= 40 ? "Produzione moderata" : "Produzione ridotta",
    flags: debugFlags,
    nota: "Stima qualitativa basata su copertura e UV. Per stima kWh/kWp servono dati GHI/DNI orari.",
  };
}

function evaluateEnergiaEolico(
  args: BioclimaticIndicesArgs,
  thresholds: Record<string, any>,
  indices: Record<string, any>,
) {
  const { windSpeedKmH } = args;
  if (windSpeedKmH !== undefined) {
    const vMs = windSpeedKmH / 3.6;
    const cutIn = 3,
      rated = 12,
      cutOut = 25;
    let powerPct = 0;
    let stato = "Nessuna produzione";
    if (vMs >= cutOut) {
      powerPct = 0;
      stato = "CUT-OUT (vento troppo forte, turbina frenata)";
    } else if (vMs >= rated) {
      powerPct = 100;
      stato = "Produzione massima (rated power)";
    } else if (vMs >= cutIn) {
      powerPct = Math.round(Math.pow((vMs - cutIn) / (rated - cutIn), 3) * 100);
      stato = `Produzione ${powerPct}% (curva cubica)`;
    } else {
      stato = "Sotto cut-in (nessuna produzione)";
    }
    indices.energiaEolico = {
      windSpeedMs: Math.round(vMs * 10) / 10,
      powerPercent: powerPct,
      stato,
      cutInMs: cutIn,
      ratedMs: rated,
      cutOutMs: cutOut,
      nota: "Curva di potenza semplificata (cubica tra cut-in e rated). Per calcolo preciso serve curva specifica turbina.",
    };
  }
}

function evaluateSpiaggiaMare(
  args: BioclimaticIndicesArgs,
  thresholds: Record<string, any>,
  indices: Record<string, any>,
) {
  const { windSpeedKmH, uvIndex, seaSurfaceTempC } = args;
  let beachScore = 100;
  const debugFlags: string[] = [];
  if (seaSurfaceTempC !== undefined) {
    if (seaSurfaceTempC < 18) {
      beachScore -= 25;
      debugFlags.push("mare_freddo");
    } else if (seaSurfaceTempC >= 18 && seaSurfaceTempC < 22) beachScore -= 10;
  }
  if (uvIndex !== undefined) {
    if (uvIndex < 3) beachScore -= 15;
  }
  if (windSpeedKmH !== undefined && windSpeedKmH > 30) {
    beachScore -= 30;
    debugFlags.push("vento_sabbia");
  } else if (windSpeedKmH !== undefined && windSpeedKmH > 15) {
    beachScore -= 10;
  }

  indices.beachIndex = {
    score: Math.max(0, beachScore),
    sstComfort: seaSurfaceTempC
      ? seaSurfaceTempC >= 22
        ? "Confortevole"
        : seaSurfaceTempC >= 18
          ? "Fresco"
          : "Freddo"
      : "N/D",
    flags: debugFlags,
  };
}

function evaluateMontagnaSci(
  args: BioclimaticIndicesArgs,
  thresholds: Record<string, any>,
  indices: Record<string, any>,
) {
  const { tempC, windSpeedKmH, snowfallSumCm } = args;
  let skiScore = 100;
  const debugFlags: string[] = [];
  if (snowfallSumCm !== undefined && snowfallSumCm < 5) {
    skiScore -= 20;
    debugFlags.push("scarsa_neve_fresca");
  }
  if (tempC > 2) {
    skiScore -= 30;
    debugFlags.push("neve_pesante_marcia");
  } else if (tempC < -10) {
    skiScore -= 10;
    debugFlags.push("molto_freddo");
  }

  if (windSpeedKmH !== undefined && windSpeedKmH > 60) {
    skiScore -= 50;
    debugFlags.push("rischio_chiusura_impianti_vento");
  }

  indices.skiIndex = {
    score: Math.max(0, skiScore),
    quality: tempC <= 0 ? "Farinosa (ottima)" : "Pesante / Marcia",
    flags: debugFlags,
  };
}

function evaluateUseCaseThresholds(args: BioclimaticIndicesArgs) {
  const { useCase } = args;
  const thresholds: Record<string, any> = {};
  const indices: Record<string, any> = {};

  switch (useCase) {
    case "agricoltura":
      evaluateAgricoltura(args, thresholds, indices);
      break;
    case "vite":
      evaluateVite(args, thresholds, indices);
      break;
    case "olivo":
      evaluateOlivo(args, thresholds, indices);
      break;
    case "apicoltura":
      evaluateApicoltura(args, thresholds, indices);
      break;
    case "solare":
      evaluateSolare(args, thresholds, indices);
      break;
    case "eolico":
      evaluateEolico(args, thresholds, indices);
      break;
    case "energia_fv":
      evaluateEnergiaFv(args, thresholds, indices);
      break;
    case "energia_eolico":
      evaluateEnergiaEolico(args, thresholds, indices);
      break;
    case "spiaggia_mare":
      evaluateSpiaggiaMare(args, thresholds, indices);
      break;
    case "montagna_sci":
      evaluateMontagnaSci(args, thresholds, indices);
      break;
  }

  return { thresholds, indices };
}
export interface BioclimaticIndicesArgs {
  tempC: number;
  relativeHumidity?: number;
  windSpeedKmH?: number;
  tempMinC?: number;
  tempMaxC?: number;
  gddBase: number;
  precip7dMm?: number;
  et07dMm?: number;
  soilMoisture0to1cm?: number;
  soilTemp6cm?: number;
  useCase?:
    | "agricoltura"
    | "apicoltura"
    | "vite"
    | "olivo"
    | "solare"
    | "eolico"
    | "montagna_sci"
    | "spiaggia_mare"
    | "energia_fv"
    | "energia_eolico";
  seaSurfaceTempC?: number;
  uvIndex?: number;
  snowfallSumCm?: number;
  snowDepthCm?: number;
  freezingLevelHeightM?: number;
  precipIntensityMmH?: number;
  isNarrowValley?: boolean;
  cloudCover?: number;
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
  const indices: Record<string, any> = {};

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
