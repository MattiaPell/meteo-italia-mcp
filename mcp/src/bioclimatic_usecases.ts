/** Valutazioni per use case (agricoltura, energia, spiaggia, sci, ...) di meteo_bioclimatic_indices. */
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

function evaluateAgricoltura(
  args: BioclimaticIndicesArgs,
  thresholds: Record<string, unknown>,
  _indices: Record<string, unknown>,
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

function evaluateVite(
  args: BioclimaticIndicesArgs,
  thresholds: Record<string, unknown>,
  _indices: Record<string, unknown>,
) {
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

function evaluateOlivo(
  args: BioclimaticIndicesArgs,
  thresholds: Record<string, unknown>,
  _indices: Record<string, unknown>,
) {
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
  thresholds: Record<string, unknown>,
  _indices: Record<string, unknown>,
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

function evaluateSolare(
  args: BioclimaticIndicesArgs,
  thresholds: Record<string, unknown>,
  _indices: Record<string, unknown>,
) {
  thresholds.solareNote = "DNI > 600 W/m² = ottimale, < 200 W/m² = basso. Rapporto direct/diffuse indica efficienza.";
}

function evaluateEolico(
  args: BioclimaticIndicesArgs,
  thresholds: Record<string, unknown>,
  _indices: Record<string, unknown>,
) {
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
  thresholds: Record<string, unknown>,
  indices: Record<string, unknown>,
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
  thresholds: Record<string, unknown>,
  indices: Record<string, unknown>,
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
  thresholds: Record<string, unknown>,
  indices: Record<string, unknown>,
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
  thresholds: Record<string, unknown>,
  indices: Record<string, unknown>,
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

export function evaluateUseCaseThresholds(args: BioclimaticIndicesArgs) {
  const { useCase } = args;
  const thresholds: Record<string, unknown> = {};
  const indices: Record<string, unknown> = {};

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
