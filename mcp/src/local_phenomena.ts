import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toToolResult, ApiResult } from "./http.js";

// --- 3. LOCAL PHENOMENA TOOL ------------------------------------------------
export function registerLocalPhenomena(server: McpServer) {
  server.registerTool(
    "meteo_local_phenomena",
    {
      title: "Riconoscimento Fenomeni Locali Italiani",
      description:
        "Riconosce i fenomeni locali tipici italiani (Bora, Foehn, Scirocco, Nebbia Padana, Gelicidio, grandine padana, ecc.) da parametri orari di previsione. Usalo dopo meteo_brief quando vento, nebbia o ghiaccio sono rilevanti per la domanda.",
      inputSchema: {
        latitude: z.coerce.number().min(-90).max(90).describe("Latitude of target"),
        longitude: z.coerce.number().min(-180).max(180).describe("Longitude of target"),
        temp2m: z.coerce.number().min(-90).max(60).describe("Temperature at 2m (°C)"),
        relHum2m: z.coerce.number().min(0).max(100).describe("Relative Humidity at 2m (%)"),
        windSpeed10m: z.coerce.number().min(0).describe("Wind speed at 10m (km/h)"),
        windDir10m: z.coerce.number().min(0).max(360).describe("Wind direction at 10m (degrees)"),
        windGusts10m: z.coerce.number().min(0).optional().describe("Wind gusts at 10m (km/h)"),
        pressureMsl: z.coerce.number().optional().describe("MSL Pressure (hPa)"),
        weatherCode: z.coerce.number().optional().describe("WMO weather code"),
        soilTemp0cm: z.coerce.number().optional().describe("Soil temperature at surface (°C)"),
        temp850hPa: z.coerce.number().optional().describe("Temperature at 850 hPa level (°C)"),
        temp925hPa: z.coerce.number().optional().describe("Temperature at 925 hPa level (°C)"),
        geopotential850hPa: z.coerce.number().optional().describe("Geopotential height at 850 hPa (m)"),
        seaSurfaceTemp: z.coerce.number().optional().describe("Sea Surface Temperature (°C)"),
        cloudCoverLow: z.coerce.number().min(0).max(100).optional().describe("Low cloud cover (%)"),
        cloudCover: z.coerce.number().min(0).max(100).optional().describe("Total cloud cover (%)"),
        cape: z.coerce.number().min(0).optional().describe("CAPE (J/kg)"),
        liftedIndex: z.coerce.number().optional().describe("Lifted Index"),
        windSpeed500hPa: z.coerce.number().min(0).optional().describe("Wind speed at 500 hPa (km/h)"),
        precip7dMm: z.coerce.number().min(0).optional().describe("7-day accumulated precipitation (mm)"),
      },
      outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({
      latitude,
      longitude,
      temp2m,
      relHum2m,
      windSpeed10m,
      windDir10m,
      windGusts10m,
      pressureMsl,
      weatherCode,
      soilTemp0cm,
      temp850hPa,
      temp925hPa,
      seaSurfaceTemp,
      cloudCoverLow,
      cloudCover,
      cape,
      windSpeed500hPa,
      precip7dMm,
    }) => {
      const start = Date.now();
      const flags: string[] = [];
      const descriptions: Record<string, string> = {};

      // 1. FOEHN (Favonio)
      const isFoehnWind = windSpeed10m > 25 && (windDir10m >= 340 || windDir10m <= 45); // N/NNE
      const isFoehnHumidity = relHum2m < 30;
      const isFoehnTarget = latitude >= 44.5 && latitude <= 46.8 && longitude >= 6.5 && longitude <= 12.5; // Alpine / Padana slopes
      if (isFoehnWind && isFoehnHumidity && isFoehnTarget) {
        flags.push("FOEHN");
        descriptions.FOEHN = `Favonio attivo sulle vallate alpine e pianura nord-occidentale. T aumentata adabaticamente, UR bassissima (${relHum2m}%).`;
      }

      // 2. BORA
      const isBoraWind = windSpeed10m > 30 && windDir10m >= 50 && windDir10m <= 85; // ENE
      const isTriesteZone = latitude >= 45.3 && latitude <= 46.0 && longitude >= 12.0 && longitude <= 14.0;
      if (isBoraWind && isTriesteZone) {
        flags.push("BORA");
        let type = "Bora Chiara (bel tempo)";
        if (weatherCode !== undefined && weatherCode >= 50) type = "Bora Scura (maltempo e precipitazioni)";
        descriptions.BORA = `Bora attiva nel golfo di Trieste e alto Adriatico. Tipologia: ${type}. Raffiche previste fino a ${windGusts10m ?? Math.round(windSpeed10m * 1.5)} km/h.`;
      }

      // 3. SCIROCCO
      const isSciroccoWind = windSpeed10m > 18 && windDir10m >= 130 && windDir10m <= 190; // SE/S
      if (isSciroccoWind) {
        flags.push("SCIROCCO");
        const type =
          relHum2m < 35
            ? "Scirocco Secco Estivo (elevato pericolo incendi)"
            : "Scirocco Umido (trasporto sabbia sahariana)";
        descriptions.SCIROCCO = `${type} attivo con vento da ${windDir10m}° a ${windSpeed10m} km/h. Tendenza a temperature superiori alla norma stagionale.`;
      }

      // 4. MAESTRALE
      const isMistralWind = windSpeed10m > 25 && windDir10m >= 280 && windDir10m <= 330; // NW
      const isSardinia = latitude >= 38.8 && latitude <= 41.3 && longitude >= 8.0 && longitude <= 10.0;
      if (isMistralWind && isSardinia) {
        flags.push("MAESTRALE");
        descriptions.MAESTRALE = `Forte Maestrale attivo sulla Sardegna e Mar Tirreno. Onde elevate su coste occidentali.`;
      }

      // 5. NEBBIA PADANA
      const isPadana = latitude >= 44.2 && latitude <= 46.0 && longitude >= 7.0 && longitude <= 13.0; // Po Valley
      const isFogConditions = relHum2m >= 92 && windSpeed10m < 6;
      const isThermalInversion = temp925hPa !== undefined && temp2m < temp925hPa;
      if (isPadana && isFogConditions) {
        flags.push("NEBBIA_PADANA");
        let prob = "Moderata";
        if (relHum2m >= 95 && windSpeed10m < 4 && isThermalInversion) prob = "Elevata (Visibilità < 100m)";
        descriptions.NEBBIA_PADANA = `Rischio Nebbia da irraggiamento in Pianura Padana con probabilità ${prob}. Inversione termica rilevata.`;
      }

      // 6. GELICIDIO (Freezing Rain)
      const hasGelicidioCode = weatherCode === 66 || weatherCode === 67;
      const isFreezingUnder = temp2m < 0 && soilTemp0cm !== undefined && soilTemp0cm < 0;
      const isWarmerAbove = temp850hPa !== undefined && temp850hPa > 0;
      if (hasGelicidioCode || (isFreezingUnder && isWarmerAbove)) {
        flags.push("GELICIDIO");
        descriptions.GELICIDIO = `PERICOLO GELICIDIO (Vetrone / Black Ice). Pioggia superraffreddata che gela al suolo (T suolo ${soilTemp0cm ?? temp2m}°C). Evitare spostamenti!`;
      }

      // 7. CALIGO / LUPA DI MARE
      const isCaligoSeason =
        seaSurfaceTemp !== undefined && seaSurfaceTemp < temp2m && relHum2m >= 90 && windSpeed10m < 12;
      if (isCaligoSeason) {
        const caligoName =
          latitude >= 43.5 && latitude <= 44.6 && longitude >= 7.3 && longitude <= 10.1
            ? "Caligo (Liguria)"
            : "Lupa di Mare (Sicilia/Ionio)";
        flags.push("NEBBIA_MARITTIMA");
        descriptions.NEBBIA_MARITTIMA = `Condizioni favorevoli per ${caligoName} costiera. Aria calda su superficie marina fredda (${seaSurfaceTemp}°C).`;
      }

      // 8. TRAMONTANA
      const isTramontana = windSpeed10m > 22 && (windDir10m >= 340 || windDir10m <= 20) && relHum2m < 50;
      if (isTramontana && !flags.includes("FOEHN")) {
        flags.push("TRAMONTANA");
        descriptions.TRAMONTANA = `Tramontana fredda e secca da Nord, cielo limpido, ottima visibilità, mare agitato al largo.`;
      }

      // 9. GARBINO
      const isGarbino =
        windSpeed10m > 20 &&
        windDir10m >= 210 &&
        windDir10m <= 250 &&
        relHum2m < 35 &&
        longitude > 12.0 &&
        latitude >= 41.5 &&
        latitude <= 44.5; // East Coast Apennines
      if (isGarbino) {
        flags.push("GARBINO");
        descriptions.GARBINO = `Garbino attivo (Favonio Appenninico) sul versante adriatico. T in brusco aumento e UR bassissima (${relHum2m}%).`;
      }

      // 10. MACCAJA
      const isMaccaja =
        latitude >= 43.8 &&
        latitude <= 44.6 &&
        longitude >= 7.3 &&
        longitude <= 10.1 &&
        relHum2m > 85 &&
        cloudCoverLow !== undefined &&
        cloudCoverLow > 75 &&
        windDir10m >= 130 &&
        windDir10m <= 230;
      if (isMaccaja) {
        flags.push("MACCAJA");
        descriptions.MACCAJA = `Maccaja ligure attiva con nubi basse e compatte ed elevata umidità bloccata dall'Appennino.`;
      }

      // 11. ADRIATIC SEA EFFECT (ASE)
      const isAse =
        temp850hPa !== undefined &&
        seaSurfaceTemp !== undefined &&
        seaSurfaceTemp - temp850hPa > 13 &&
        windDir10m >= 30 &&
        windDir10m <= 90 &&
        longitude >= 12.0 &&
        longitude <= 18.0 &&
        latitude >= 39.5 &&
        latitude <= 44.0;
      if (isAse) {
        flags.push("ADRIATIC_SEA_EFFECT");
        descriptions.ADRIATIC_SEA_EFFECT = `Adriatic Sea Effect (ASE) attivo: aria gelida siberiana su mare Adriatico caldo. Rischio bande nevose intense su Marche, Abruzzo, Molise e Puglia.`;
      }

      // 12. ACQUA ALTA
      const isAcquaAltaTigger =
        pressureMsl !== undefined &&
        pressureMsl < 1005 &&
        windDir10m >= 110 &&
        windDir10m <= 150 &&
        windSpeed10m > 30 &&
        latitude >= 45.0 &&
        latitude <= 45.8 &&
        longitude >= 12.0 &&
        longitude <= 13.5;
      if (isAcquaAltaTigger) {
        flags.push("ACQUA_ALTA");
        descriptions.ACQUA_ALTA = `Rischio ACQUA ALTA a Venezia. Bassa pressione (${pressureMsl} hPa) combinata con forte Scirocco persistente sull'asse adriatico.`;
      }

      // 13. MCS PADANO & TEMPORALE AUTORIGENERANTE (V-SHAPED)
      if (cape !== undefined && cape > 1000) {
        let isVShaped = false;
        if (windSpeed500hPa !== undefined && windSpeed500hPa > 70 && relHum2m > 75) {
          isVShaped = true;
          flags.push("V_SHAPED_STORM");
          descriptions.V_SHAPED_STORM = `Rischio TEMPORALE AUTORIGENERANTE (V-Shaped) stazionario e distruttivo. Elevato pericolo alluvioni lampo localizzate.`;
        }
        if (!isVShaped && isPadana) {
          flags.push("MCS_PADANO");
          descriptions.MCS_PADANO = `Rischio MCS (Mesoscale Convective System) Padano con forte instabilità (CAPE ${cape} J/kg). Possibili colpi di vento e grandine.`;
        }
      }

      // 14. GALAVERNA vs BRINA
      if (temp2m < 0 && soilTemp0cm !== undefined && soilTemp0cm < 0) {
        if (relHum2m > 95 && (weatherCode === 45 || weatherCode === 48)) {
          flags.push("GALAVERNA");
          descriptions.GALAVERNA = `Galaverna attiva: aghi di ghiaccio per nebbia sopraffusa a ${temp2m}°C.`;
        } else if (cloudCover !== undefined && cloudCover < 20 && windSpeed10m < 4) {
          flags.push("BRINA");
          descriptions.BRINA = `Brina diffusa al suolo dovuta a forte irraggiamento notturno in cielo sereno.`;
        }
      }

      // 15. LIBECCIO
      const isLibeccio = windSpeed10m > 25 && windDir10m >= 210 && windDir10m <= 250;
      const isTirreno = longitude >= 9.0 && longitude <= 16.0 && latitude >= 37.0 && latitude <= 44.0;
      if (isLibeccio && isTirreno) {
        flags.push("LIBECCIO");
        descriptions.LIBECCIO = `Libeccio forte sul Tirreno (vento da ${windDir10m}° a ${windSpeed10m} km/h). Mare molto agitato su coste occidentali, onde fino a ${windSpeed10m > 40 ? "4-6m" : "2-3m"}.`;
      }

      // 16. GELO DA IRRAGGIAMENTO
      const isGeloIrraggiamento =
        temp2m < 0 && cloudCover !== undefined && cloudCover < 15 && windSpeed10m < 5 && relHum2m > 60;
      const isValle = precip7dMm !== undefined && precip7dMm < 2;
      if (isGeloIrraggiamento && isValle) {
        flags.push("GELO_IRRAGGIAMENTO");
        descriptions.GELO_IRRAGGIAMENTO = `Gelo da irraggiamento notturno in vallata. T ${temp2m}°C, cielo sereno (${cloudCover}%), vento quasi assente. Possibili ${temp2m < -5 ? "formazioni di ghiaccio nero" : "brinate diffuse"}.`;
      }

      // 17. NEBBIA DA AVVEZIONE
      const isNebbiaAvvezione =
        relHum2m >= 95 && windSpeed10m >= 5 && windSpeed10m <= 15 && cloudCoverLow !== undefined && cloudCoverLow > 90;
      const isCosta = seaSurfaceTemp !== undefined && temp2m - seaSurfaceTemp > 3;
      if (isNebbiaAvvezione && isCosta) {
        flags.push("NEBBIA_AVVEZIONE");
        descriptions.NEBBIA_AVVEZIONE = `Nebbia da avvezione costiera. Aria calda e umida (${temp2m}°C, UR ${relHum2m}%) su mare più freddo (${seaSurfaceTemp}°C). Visibilità < 500m, critica per navigazione e viabilità costiera.`;
      }

      // 18. BREVA / TIVANO (Lago di Como)
      const isLagoDiComo = latitude >= 45.8 && latitude <= 46.2 && longitude >= 9.0 && longitude <= 9.5;
      if (isLagoDiComo && windSpeed10m > 8) {
        const hour = new Date().getHours();
        if (hour >= 10 && hour <= 18 && windDir10m >= 170 && windDir10m <= 210) {
          flags.push("BREVA");
          descriptions.BREVA = `Breva attiva sul Lago di Como: brezza diurna da Sud (ore ${hour}). Vento regolare ${windSpeed10m} km/h, ideale per vela.`;
        } else if (((hour >= 20 || hour <= 8) && windDir10m >= 340) || windDir10m <= 20) {
          flags.push("TIVANO");
          descriptions.TIVANO = `Tivano attivo sul Lago di Como: brezza notturna da Nord (ore ${hour}). Vento fresco ${windSpeed10m} km/h.`;
        }
      }

      const res: ApiResult = {
        ok: true,
        url: "mcp://local_phenomena",
        status: 200,
        data: {
          detectedPhenomena: flags,
          alerts: descriptions,
        },
        elapsedMs: Date.now() - start,
      };
      return toToolResult(res);
    },
  );
}
