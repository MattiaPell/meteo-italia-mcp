import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toToolResult, ApiResult } from "./http.js";

const CORE_MODELS = [
  {
    id: "ecmwf_ifs",
    name: "ECMWF IFS HRES 9km",
    resolution: "9 km",
    coverage: "Globale",
    update: "6h",
    forecastDays: 10,
    weight: 1.4,
  },
  {
    id: "ecmwf_ifs025",
    name: "ECMWF IFS 0.25°",
    resolution: "25 km",
    coverage: "Globale",
    update: "6h",
    forecastDays: 10,
    weight: 1.2,
  },
  {
    id: "icon_seamless",
    name: "DWD ICON Seamless",
    resolution: "2–13 km",
    coverage: "Globale+EU",
    update: "1-3h",
    forecastDays: "7–16",
    weight: 1.0,
  },
  {
    id: "icon_global",
    name: "DWD ICON Global",
    resolution: "13 km",
    coverage: "Globale",
    update: "6h",
    forecastDays: 16,
    weight: 1.0,
  },
  {
    id: "icon_eu",
    name: "DWD ICON EU",
    resolution: "7 km",
    coverage: "Europa",
    update: "3h",
    forecastDays: 5,
    weight: 1.0,
  },
  {
    id: "icon_d2",
    name: "DWD ICON D2",
    resolution: "2 km",
    coverage: "Europa Centrale",
    update: "1h",
    forecastDays: 2,
    weight: 1.3,
  },
  {
    id: "italia_meteo_arpae_icon_2i",
    name: "ItaliaMeteo ARPAE ICON 2I",
    resolution: "2.2 km",
    coverage: "Italia",
    update: "1h",
    forecastDays: 5,
    weight: 1.5,
  },
  {
    id: "meteofrance_seamless",
    name: "Météo-France Seamless",
    resolution: "1.3–40 km",
    coverage: "Globale+EU",
    update: "1-6h",
    forecastDays: "4–15",
    weight: 0.9,
  },
  {
    id: "arpege_europe",
    name: "Météo-France ARPEGE Europe",
    resolution: "11 km",
    coverage: "Europa",
    update: "3h",
    forecastDays: 4,
    weight: 0.9,
  },
  {
    id: "arome_france",
    name: "Météo-France AROME France",
    resolution: "2.5 km",
    coverage: "Francia+vicini",
    update: "1h",
    forecastDays: 2,
    weight: 0.8,
  },
  {
    id: "meteoswiss_icon_seamless",
    name: "MeteoSwiss ICON Seamless",
    resolution: "1–11 km",
    coverage: "Svizzera+Alpi",
    update: "1-3h",
    forecastDays: 5,
    weight: 1.2,
  },
  {
    id: "geosphere_seamless",
    name: "GeoSphere Austria Seamless",
    resolution: "1–25 km",
    coverage: "Alpi Centrale+EU",
    update: "1-6h",
    forecastDays: 5,
    weight: 1.0,
  },
  {
    id: "knmi_seamless",
    name: "KNMI Harmonie/Seamless",
    resolution: "1–11 km",
    coverage: "Olanda+Mar del Nord",
    update: "1-3h",
    forecastDays: 2,
    weight: 0.9,
  },
];

const GLOBAL_MODELS = [
  {
    id: "gfs_seamless",
    name: "NCEP GFS Seamless",
    resolution: "11–22 km",
    coverage: "Globale",
    update: "1h",
    forecastDays: 16,
    weight: 0.8,
  },
  {
    id: "gfs025",
    name: "NCEP GFS 0.25°",
    resolution: "25 km",
    coverage: "Globale",
    update: "6h",
    forecastDays: 16,
    weight: 0.6,
  },
  {
    id: "ecmwf_aifs025",
    name: "ECMWF AIFS (AI model)",
    resolution: "25 km",
    coverage: "Globale",
    update: "6h",
    forecastDays: 10,
    weight: 0.7,
  },
  {
    id: "gfs_graphcast025",
    name: "NCEP GFS GraphCast",
    resolution: "25 km",
    coverage: "Globale",
    update: "6h",
    forecastDays: 10,
    weight: 0.7,
  },
  {
    id: "gem_seamless",
    name: "GEM Canada Seamless",
    resolution: "2.5–15 km",
    coverage: "Globale",
    update: "3-6h",
    forecastDays: 16,
    weight: 0.6,
  },
  {
    id: "jma_seamless",
    name: "JMA Seamless",
    resolution: "5–55 km",
    coverage: "Globale",
    update: "3-6h",
    forecastDays: 11,
    weight: 0.6,
  },
];

const SELECTION_BY_MACROAREA = {
  nord_ovest: {
    core: "italia_meteo_arpae_icon_2i, icon_d2, icon_seamless, ecmwf_ifs025, arome_france, gfs_seamless, meteoswiss_icon_seamless",
    note: "Usa arome_france per la fascia costiera, meteoswiss_icon_seamless per Alpi",
  },
  nord_est: {
    core: "italia_meteo_arpae_icon_2i, icon_d2, icon_seamless, ecmwf_ifs025, gfs_seamless, meteoswiss_icon_seamless, geosphere_seamless",
    note: "Priorità ad ARPAE ICON 2I e ICON D2 per Bora e convezione",
  },
  centro_nord: {
    core: "italia_meteo_arpae_icon_2i, icon_seamless, icon_eu, ecmwf_ifs025, meteofrance_seamless, gfs_seamless",
    note: "Consensus bilanciato con ARPAE ICON 2I",
  },
  centro: {
    core: "ecmwf_ifs025, icon_seamless, meteofrance_seamless, arpege_europe, gfs_seamless, icon_eu",
    note: "ECMWF IFS ha peso elevato",
  },
  sud: {
    core: "ecmwf_ifs025, ecmwf_aifs025, arpege_europe, icon_seamless, gfs_seamless, meteofrance_seamless",
    note: "Usa GFS e ARPEGE per Scirocco e vento sinottico",
  },
  sicilia: {
    core: "ecmwf_ifs025, ecmwf_aifs025, arpege_europe, gfs_seamless, meteofrance_seamless",
    note: "ARPAE ICON 2I ha copertura ridotta, usa ECMWF come backbone",
  },
  sardegna: {
    core: "ecmwf_ifs025, ecmwf_aifs025, meteofrance_seamless, arpege_europe, gfs_seamless",
    note: "Maestrale dominato da ECMWF e AROME/ARPEGE",
  },
};

function getModelsData() {
  return {
    coreModels: CORE_MODELS,
    globalModels: GLOBAL_MODELS,
    selectionByMacroarea: SELECTION_BY_MACROAREA,
  };
}

function getMarineData() {
  return {
    douglasScaleWindSea: [
      { degree: 0, description: "Calmo (specchio)", heightM: "0", action: "Navigazione sicura" },
      { degree: 1, description: "Quasi calmo", heightM: "0 – 0.10", action: "Navigazione sicura" },
      { degree: 2, description: "Poco mosso", heightM: "0.10 – 0.50", action: "Navigazione sicura" },
      { degree: 3, description: "Mosso", heightM: "0.50 – 1.25", action: "Cautela piccola nautica" },
      { degree: 4, description: "Molto mosso", heightM: "1.25 – 2.50", action: "Sconsigliato piccola nautica" },
      { degree: 5, description: "Agitato", heightM: "2.50 – 4.00", action: "Pericolo per balneazione e nautica" },
      { degree: 6, description: "Molto agitato", heightM: "4.00 – 6.00", action: "Navigazione difficile" },
      { degree: 7, description: "Grosso", heightM: "6.00 – 9.00", action: "Solo grandi navi" },
      { degree: 8, description: "Molto grosso", heightM: "9.00 – 14.00", action: "Emergenza" },
      { degree: 9, description: "Tempestoso", heightM: "> 14.00", action: "Condizioni eccezionali" },
    ],
    douglasScaleSwell: [
      { range: "0 – 2 m", class: "Bassa", description: "Onde lunghe e basse" },
      { range: "2 – 4 m", class: "Media", description: "Onde lunghe e moderate" },
      { range: "> 4 m", class: "Alta", description: "Onde lunghe e alte" },
    ],
    swellPeriod: [
      { periodS: "< 6s", class: "Corta", description: "Onde frequenti (Wind Sea)" },
      { periodS: "6 – 10s", class: "Media", description: "Onde regolari" },
      { periodS: "> 10s", class: "Lunga", description: "Onde distanziate (Swell / post-burrasca)" },
    ],
    beaufortScale: [
      { degree: 0, speedKmH: "<1", description: "Calma", effect: "Fumo sale verticale" },
      { degree: 1, speedKmH: "1–5", description: "Bava di vento", effect: "Fumo inclinato" },
      { degree: 2, speedKmH: "6–11", description: "Brezza leggera", effect: "Foglie muovono" },
      { degree: 3, speedKmH: "12–19", description: "Brezza tesa", effect: "Bandiere spiegate" },
      { degree: 4, speedKmH: "20–28", description: "Vento moderato", effect: "Solleva polvere" },
      { degree: 5, speedKmH: "29–38", description: "Vento teso", effect: "Piccoli alberi oscillano" },
      { degree: 6, speedKmH: "39–49", description: "Vento fresco", effect: "Grandi rami muovono" },
      { degree: 7, speedKmH: "50–61", description: "Vento forte", effect: "Difficoltà con ombrelli" },
      { degree: 8, speedKmH: "62–74", description: "Burrasca", effect: "Ramoscelli si spezzano" },
      { degree: 9, speedKmH: "75–88", description: "Burrasca forte", effect: "Danni alle strutture" },
    ],
    sstComfort: [
      { range: "<18°C", comfort: "Molto fredda", note: "Necessaria muta per permanenza prolungata" },
      { range: "18–21°C", comfort: "Fredda", note: "Rinfrescante, richiede adattamento" },
      { range: "22–24°C", comfort: "Ideale", note: "Perfetta per la maggior parte dei bagnanti" },
      { range: "25–27°C", comfort: "Calda", note: "Tipica del pieno agosto nel Med" },
      { range: ">28°C", comfort: "Molto calda", note: "Possibile stress ecosistema / mucillagine" },
    ],
    coastalTraversiaRiskMatrix: [
      {
        area: "Liguria Centrale/Levante",
        cities: "Genova, Chiavari, Spezia",
        traversia: "200° – 240°",
        windCrit: "Libeccio",
        waveThresholdM: 3.0,
      },
      {
        area: "Liguria Ponente",
        cities: "Savona, Imperia, Sanremo",
        traversia: "150° – 200°",
        windCrit: "Scirocco / Mezzogiorno",
        waveThresholdM: 2.5,
      },
      {
        area: "Toscana Nord / Versilia",
        cities: "Viareggio, Massa, Livorno",
        traversia: "220° – 260°",
        windCrit: "Libeccio",
        waveThresholdM: 3.0,
      },
      {
        area: "Toscana Sud / Lazio",
        cities: "Grosseto, Civitavecchia, Ostia",
        traversia: "230° – 270°",
        windCrit: "Libeccio / Ponente",
        waveThresholdM: 2.5,
      },
      {
        area: "Campania / Calabria Tirr.",
        cities: "Napoli, Salerno, Paola",
        traversia: "240° – 280°",
        windCrit: "Ponente / Libeccio",
        waveThresholdM: 3.0,
      },
      {
        area: "Sardegna Ovest",
        cities: "Alghero, Oristano, Bosa",
        traversia: "270° – 320°",
        windCrit: "Maestrale",
        waveThresholdM: 4.0,
      },
      {
        area: "Sardegna Est",
        cities: "Olbia, Nuoro, Costa Rei",
        traversia: "90° – 140°",
        windCrit: "Levante / Scirocco",
        waveThresholdM: 2.5,
      },
      {
        area: "Sicilia Nord",
        cities: "Palermo, Cefalù, Messina",
        traversia: "310° – 350°",
        windCrit: "Tramontana / Maestrale",
        waveThresholdM: 3.0,
      },
      {
        area: "Sicilia Sud",
        cities: "Agrigento, Gela, Pozzallo",
        traversia: "180° – 230°",
        windCrit: "Libeccio / Scirocco",
        waveThresholdM: 2.5,
      },
      {
        area: "Sicilia Est / Calabria Jon.",
        cities: "Catania, Siracusa, Crotone",
        traversia: "90° – 130°",
        windCrit: "Levante / Scirocco",
        waveThresholdM: 3.0,
      },
      {
        area: "Puglia Adriatica / Gargano",
        cities: "Vieste, Bari, Brindisi",
        traversia: "30° – 70°",
        windCrit: "Bora / Grecale",
        waveThresholdM: 2.5,
      },
      {
        area: "Puglia Salento (Jonico)",
        cities: "Gallipoli, Porto Cesareo",
        traversia: "180° – 220°",
        windCrit: "Scirocco / Libeccio",
        waveThresholdM: 2.0,
      },
      {
        area: "Marche / Abruzzo / Molise",
        cities: "Ancona, Pescara, Termoli",
        traversia: "30° – 60°",
        windCrit: "Bora / Grecale",
        waveThresholdM: 3.0,
      },
      {
        area: "Alto Adriatico / Romagna",
        cities: "Rimini, Ravenna, Chioggia",
        traversia: "60° – 120°",
        windCrit: "Bora / Levante",
        waveThresholdM: 2.0,
      },
      {
        area: "Laguna di Venezia",
        cities: "Venezia, Lido",
        traversia: "120° – 160°",
        windCrit: "Scirocco",
        waveThresholdM: 1.5,
      },
    ],
  };
}

function getAirQualityData() {
  return {
    aqiEuropeanScale: [
      { aqiRange: "0–20", level: "Buono", color: "🟢", pm25: "0–10", pm10: "0–20", no2: "0–40", o3: "0–50" },
      {
        aqiRange: "20–40",
        level: "Discreto",
        color: "🟡",
        pm25: "10–20",
        pm10: "20–40",
        no2: "40–90",
        o3: "50–100",
      },
      {
        aqiRange: "40–60",
        level: "Moderato",
        color: "🟠",
        pm25: "20–25",
        pm10: "40–50",
        no2: "90–120",
        o3: "100–130",
      },
      {
        aqiRange: "60–80",
        level: "Scarso",
        color: "🔴",
        pm25: "25–50",
        pm10: "50–100",
        no2: "120–230",
        o3: "130–240",
      },
      {
        aqiRange: "80–100",
        level: "Molto scarso",
        color: "🟣",
        pm25: "50–75",
        pm10: "100–150",
        no2: "230–340",
        o3: "240–380",
      },
      { aqiRange: ">100", level: "Pessimo", color: "⚫", pm25: ">75", pm10: ">150", no2: ">340", o3: ">380" },
    ],
    pollenThresholdsAia: [
      { type: "Graminacee (grass)", low: "0.6 – 9.9", medium: "10 – 29.9", high: "> 30" },
      { type: "Betulle/Ontano (birch/alder)", low: "0.6 – 15.9", medium: "16 – 49.9", high: "> 50" },
      { type: "Olivo (olive)", low: "0.6 – 4.9", medium: "5 – 24.9", high: "> 25" },
      { type: "Ambrosia/Artemisia (ragweed/mugwort)", low: "0.1 – 4.9", medium: "5 – 24.9", high: "> 25" },
      { type: "Parietaria (Urticaceae)", low: "2.0 – 19.9", medium: "20 – 69.9", high: "> 70" },
      { type: "Cipresso (Cupressaceae)", low: "4.0 – 29.9", medium: "30 – 89.9", high: "> 90" },
    ],
    pollenCalendarItaly: {
      ontano: { nord: "gen–mar", centro_sud: "dic–feb" },
      betulla: { nord: "mar–apr", centro_sud: "feb–mar" },
      graminacee: { nord: "apr–giu", centro_sud: "mar–mag" },
      olivo: { nord: "mag–giu", centro_sud: "apr–mag" },
      artemisia: { nord: "lug–set", centro_sud: "lug–ago" },
      ambrosia: { nord: "ago–set", centro_sud: "ago–set" },
    },
    boundaryLayerMixingHeight: [
      {
        range: "< 300 m",
        risk: "Estremo",
        scenario: "Inquinanti intrappolati vicino al suolo (inversione notturna)",
      },
      { range: "300 – 500 m", risk: "Alto", scenario: "Ventilazione scarsa, ristagno PM10/NO2" },
      { range: "500 – 1000 m", risk: "Moderato", scenario: "Condizioni di dispersione medie" },
      { range: "> 1000 m", risk: "Basso", scenario: "Ottima dispersione verticale (aria pulita)" },
    ],
    protocolloAriaPadana: {
      verde: { range: "< 50 µg/m³", level: "Livello 0", action: "Nessuna restrizione" },
      arancio: {
        range: "> 50 µg/m³ per 2gg cons.",
        level: "Livello 1",
        action: "Blocco Euro 4/5 diesel, riscaldamento a legna",
      },
      rosso: { range: "> 75 µg/m³ per 2gg cons.", level: "Livello 2", action: "Restrizioni commerciali estese" },
    },
  };
}

function getMountainData() {
  return {
    avalancheDangerScaleAineva: [
      {
        grade: 1,
        level: "Debole",
        color: "🟢",
        stability: "Ben consolidato e stabile",
        triggers: "Solo con forte sovraccarico su pendii ripidi",
      },
      {
        grade: 2,
        level: "Moderato",
        color: "🟡",
        stability: "Moderatamente stabile",
        triggers: "Possibili con forte sovraccarico su pendii ripidi",
      },
      {
        grade: 3,
        level: "Marcato",
        color: "🟠",
        stability: "Da moderata a debole",
        triggers: "Possibili anche con debole sovraccarico",
      },
      {
        grade: 4,
        level: "Forte",
        color: "🔴",
        stability: "Debolmente consolidato",
        triggers: "Molte valanghe spontanee anche di grandi dimensioni",
      },
      {
        grade: 5,
        level: "Molto Forte",
        color: "⚫",
        stability: "Instabile",
        triggers: "Valanghe catastrofiche molto grandi spontanee",
      },
    ],
    windChillDanger: [
      { range: "0 a -10°C", class: "Fastidio", risk: "Lievi disagi per esposizione prolungata" },
      { range: "-10 a -25°C", class: "Freddo Intenso", risk: "Rischio moderato di congelamento" },
      { range: "-25 a -45°C", class: "Freddo Estremo", risk: "Pericolo grave, congelamento in pochi minuti" },
      { range: "< -45°C", class: "Emergenza", risk: "Pericolo imminente" },
    ],
    snowQualityMatrix: [
      {
        quality: "Farinosa",
        conditions: "snowfall > 0, T < -3°C, Vento < 15 km/h, UR < 70%",
        note: "Ideale per sci fuori pista",
      },
      {
        quality: "Crostosa",
        conditions: "snowfall = 0, Ciclo +/- 0°C, Vento > 25 km/h",
        note: "Presenza di crosta da vento",
      },
      {
        quality: "Pesante",
        conditions: "snowfall > 0, T -1 a +1°C, UR > 85%",
        note: "Neve bagnata, faticosa, rischio valanghe",
      },
      { quality: "Marcia", conditions: "T > 5°C per 3+ ore", note: "Neve primaverile bagnatissima" },
      { quality: "Ghiacciata", conditions: "T < -5°C", note: "Fondo duro" },
    ],
  };
}

function getHydroData() {
  return {
    poRiverThresholdsAipo: [
      { station: "Piacenza", prov: "PC", zeroM: 42.41, yellowS1: 5.0, orangeS2: 6.0, redS3: 7.0 },
      { station: "Cremona", prov: "CR", zeroM: 34.4, yellowS1: 2.2, orangeS2: 3.2, redS3: 4.2 },
      { station: "Casalmaggiore", prov: "CR", zeroM: 24.31, yellowS1: 3.8, orangeS2: 5.0, redS3: 6.2 },
      { station: "Boretto", prov: "RE", zeroM: 21.64, yellowS1: 4.5, orangeS2: 5.5, redS3: 6.5 },
      { station: "Borgoforte", prov: "MN", zeroM: 14.15, yellowS1: 5.0, orangeS2: 6.0, redS3: 7.0 },
      { station: "Pontelagoscuro", prov: "FE", zeroM: 8.38, yellowS1: 0.5, orangeS2: 1.3, redS3: 2.5 },
    ],
    arnoRiverThresholdsCfr: [
      { station: "Nave di Rovezzano", location: "Firenze Est", yellowS1: 3.0, redS3: 4.5 },
      { station: "Firenze Uffizi", location: "Centro Storico", yellowS1: 3.0, redS3: 5.5 },
      { station: "Ponte a Signa", location: "Firenze Ovest", yellowS1: 5.5, redS3: 8.5 },
      { station: "S. Giovanni alla Vena", location: "Pisa", yellowS1: 4.5, redS3: 7.1 },
    ],
    tevereRiverThresholdsLazio: [
      { station: "Roma Ripetta", location: "Centro Storico", yellowS1: 7.0, orangeS2: 10.0, redS3: 12.5 },
      { station: "Isola Tiberina", location: "Centro Storico", yellowS1: 6.5, orangeS2: 9.0, redS3: 11.0 },
    ],
    renoRiverThresholdsArpae: [
      { station: "Casalecchio Chiusa", location: "Bologna", yellowS1: 0.8, orangeS2: 1.6, redS3: 2.2 },
    ],
    volturnoCapuaInfo:
      "Nessuna soglia fissa in tabella. Piena storica 2023 ~8.20m. Fare riferimento al Bollettino Multirischi Campania.",
    floodsItStationsTrentino: [
      { id: "ADIGE_TRENTO", river: "Adige", location: "Trento", yellow: 3.0, red: 4.0 },
      { id: "ADIGE_ROVERETO", river: "Adige", location: "Rovereto", yellow: 2.8, red: 3.8 },
      { id: "BRENTA_BASSANO", river: "Brenta", location: "Bassano del Grappa", yellow: 3.5, red: 4.5 },
      { id: "SARCA_ARCO", river: "Sarca", location: "Arco", yellow: 2.0, red: 3.0 },
    ],
    arpavStationsVeneto: [
      { id: 124, river: "Adige", location: "Verona (Pte Nuovo)", s1: 1.0, s2: 1.5, s3: 2.0 },
      { id: 142, river: "Adige", location: "Boara Pisani", s1: 2.5, s2: 3.5, s3: 4.5 },
      { id: 105, river: "Brenta", location: "Bassano (Barzizza)", s1: 1.5, s2: 2.5, s3: 3.5 },
      { id: 108, river: "Bacchiglione", location: "Vicenza (Pte degli Angeli)", s1: 4.5, s2: 5.5, s3: 6.0 },
      { id: 132, river: "Po", location: "Ariano (Delta)", s1: 2.5, s2: 3.5, s3: 4.5 },
    ],
    corrivazioneHours: {
      po_piacenza_to_pontelagoscuro: "48-72 ore",
      adige_trento_to_verona: "6-10 ore",
      arno_firenze_to_pisa: "8-12 ore",
    },
  };
}

function getNowcastingData() {
  return {
    vmiReflectivityTableDpc: [
      { dbz: "15–20", intensity: "Molto debole", description: "Pioviggine o nubi dense" },
      { dbz: "20–35", intensity: "Debole/Moderata", description: "Pioggia ordinaria" },
      { dbz: "35–45", intensity: "Forte", description: "Rovesci intensi (temporale)" },
      { dbz: "45–55", intensity: "Molto forte", description: "Temporale severo, possibile grandine piccola" },
      {
        dbz: ">55",
        intensity: "Estrema",
        description: "Temporale violento, grandine grossa altamente probabile",
      },
    ],
    blendingRadarNwpMatrix: [
      { horizonMin: "0–15", radarWeight: 1.0, nwpWeight: 0.0, strategy: "Radar Dominante" },
      { horizonMin: "15–45", radarWeight: 0.8, nwpWeight: 0.2, strategy: "Validazione NWP" },
      {
        horizonMin: "45–90",
        radarWeight: 0.4,
        nwpWeight: 0.6,
        strategy: "Correzione Temporale (traslazione ritardo/anticipo)",
      },
      { horizonMin: ">90", radarWeight: 0.0, nwpWeight: 1.0, strategy: "NWP Dominante (ICON-D2 / ECMWF)" },
    ],
  };
}

function getSatelliteData() {
  return {
    eumetviewChannels: [
      {
        channel: "IR10.8",
        name: "Infrarosso termico",
        use: "Copertura nuvolosa, temperatura top nubi, celle convettive notturne/diurne",
      },
      {
        channel: "VIS0.6",
        name: "Visibile",
        use: "Estensione nebbie, nubi basse, polvere sahariana in ore diurne",
      },
      { channel: "WV0.62", name: "Water Vapor", use: "Umidità media troposfera, correnti a getto, vorticità" },
    ],
    satelliteInterpretationRules: {
      fronts: "Bande nuvolose continue IR10.8 indicano fronti atlantici. Confrontare posizione reale vs modelli NWP.",
      cells:
        "Tops nuvolosi molto freddi (IR10.8 < -60°C) indicano temporali intensi. Presenza di overshooting top = supercella.",
      fog: "Strato uniforme in VIS0.6 non visibile in IR10.8 notturno indica nebbia da irraggiamento.",
      dust: "Area diffusa in canale IR8.7 / RGB Dust conferma trasporto polvere sahariana.",
    },
  };
}

function getLightningData() {
  return {
    densityThresholds: [
      { count15MinPer50Km2: ">0", severity: "Attività elettrica", risk: "Fulmini isolati in zona" },
      {
        count15MinPer50Km2: ">10",
        severity: "Temporale attivo",
        risk: "Fulminazione frequente, temporale organizzato",
      },
      {
        count15MinPer50Km2: ">20",
        severity: "Temporale severo",
        risk: "Rischio grandine elevato, downburst, temporale molto forte",
      },
    ],
    distanceHazard: [
      {
        nearestKm: "<5",
        hazard: "Pericolo immediato",
        action: "Evacuare creste, spiaggia, ripararsi in struttura chiusa",
      },
      { nearestKm: "5-15", hazard: "In zona", action: "Trovare riparo a breve" },
      { nearestKm: ">15", hazard: "Nelle vicinanze", action: "Monitorare evoluzione radar/fulmini" },
    ],
    dryLightningRisk:
      "Fulmini con precipitazione al suolo <1mm indica rischio elevato incendi (vegetazione secca). Comunissimo con Scirocco/Garbino.",
  };
}

function getAviationData() {
  return {
    icaoAirportsItaly: {
      nord_ovest: [
        { icao: "LIMC", name: "Milano Malpensa", elevationM: 234, note: "Hub internazionale" },
        { icao: "LIML", name: "Milano Linate", elevationM: 107, note: "Urbano, nebbia padana" },
        { icao: "LIME", name: "Bergamo Orio al Serio", elevationM: 237, note: "Low-cost" },
        { icao: "LIMF", name: "Torino Caselle", elevationM: 301, note: "Frequente Foehn" },
        { icao: "LIMJ", name: "Genova Sestri", elevationM: 4, note: "Costiero, Maccaja/Caligo" },
      ],
      nord_est: [
        { icao: "LIPZ", name: "Venezia Tessera", elevationM: 2, note: "Lagunare, nebbia/acqua alta" },
        { icao: "LIPX", name: "Verona Villafranca", elevationM: 68, note: "Pianura" },
        { icao: "LIPE", name: "Bologna Borgo Panigale", elevationM: 37, note: "Pianura Padana" },
        { icao: "LIPB", name: "Bolzano", elevationM: 241, note: "Valle alpina, Foehn" },
      ],
      centro: [
        { icao: "LIRF", name: "Roma Fiumicino", elevationM: 5, note: "Hub internazionale costiero" },
        { icao: "LIRA", name: "Roma Ciampino", elevationM: 130, note: "Urbano" },
        { icao: "LIRP", name: "Pisa San Giusto", elevationM: 2, note: "Costiero tirrenico" },
        { icao: "LIRZ", name: "Perugia Sant'Egidio", elevationM: 205, note: "Collinare" },
      ],
      sud_isole: [
        { icao: "LIRN", name: "Napoli Capodichino", elevationM: 90, note: "Urbano" },
        { icao: "LIBD", name: "Bari Palese", elevationM: 54, note: "Costiero" },
        { icao: "LICC", name: "Catania Fontanarossa", elevationM: 12, note: "Etna, venti forti" },
        {
          icao: "LICJ",
          name: "Palermo Falcone Borsellino",
          elevationM: 19,
          note: "Costiero tirrenico, scirocco",
        },
        { icao: "LIEE", name: "Cagliari Elmas", elevationM: 4, note: "Costiero tirrenico" },
      ],
    },
    validationRules: {
      temperature: "Scarto >2°C indica bias del modello, scarto >4°C indica modello inaffidabile per il punto.",
      wind: "Scarto velocità >10kt indica sottostima vento, raffiche >20kt non previste sono critiche.",
      visibility: "Visibilità <2000m ma NWP sereno indica nebbia non risolta dal modello (critico viabilità).",
      ceiling: "Base nubi (ceiling) <1000ft indica regole di volo IFR.",
    },
  };
}

function getPortalsData() {
  return {
    italianPortalsFallbacks: [
      { name: "3bMeteo", coverage: "Nazionale", url: "https://www.3bmeteo.com" },
      { name: "iLMeteo", coverage: "Nazionale", url: "https://www.ilmeteo.it" },
      { name: "Meteo.it", coverage: "Nazionale", url: "https://www.meteo.it" },
      { name: "LAMMA Toscana", coverage: "Regionale (Toscana/Centro)", url: "https://www.lamma.toscana.it" },
      { name: "MeteoAM", coverage: "Nazionale (Aeronautica)", url: "https://www.meteoam.it" },
    ],
    consensusRules:
      "Confrontare almeno 3 portali indipendenti. Se divergono, dichiarare esplicitamente l'incertezza e mostrare gli scenari alternativi.",
  };
}

function getPollenData() {
  return {
    pollenCalendarItaly: {
      ontano: { nord: "gen–mar", centro_sud: "dic–feb", peak: "feb" },
      betulla: { nord: "mar–apr", centro_sud: "feb–mar", peak: "mar" },
      cipresso: { nord: "feb–apr", centro_sud: "gen–mar", peak: "mar" },
      graminacee: { nord: "apr–giu", centro_sud: "mar–mag", peak: "mag" },
      olivo: { nord: "mag–giu", centro_sud: "apr–mag", peak: "mag" },
      parietaria: { nord: "mar–ott", centro_sud: "feb–nov", peak: "apr" },
      artemisia: { nord: "lug–set", centro_sud: "lug–ago", peak: "ago" },
      ambrosia: { nord: "ago–set", centro_sud: "ago–set", peak: "set" },
    },
    thresholdsAia: [
      { type: "Graminacee", low: "0.6–9.9", medium: "10–29.9", high: "≥30", unit: "grani/m³" },
      { type: "Olivo", low: "0.6–4.9", medium: "5–24.9", high: "≥25", unit: "grani/m³" },
      { type: "Betulle/Ontano", low: "0.6–15.9", medium: "16–49.9", high: "≥50", unit: "grani/m³" },
      { type: "Parietaria", low: "2.0–19.9", medium: "20–69.9", high: "≥70", unit: "grani/m³" },
      { type: "Ambrosia", low: "0.1–4.9", medium: "5–24.9", high: "≥25", unit: "grani/m³" },
      { type: "Cipresso", low: "4.0–29.9", medium: "30–89.9", high: "≥90", unit: "grani/m³" },
    ],
    weatherFactors:
      "Pioggia abbassa polline (lavaggio aria). Vento >15 km/h aumenta dispersione. T >15°C e secco favorisce rilascio. Nebbia intrappola polline vicino al suolo.",
  };
}

function getUvData() {
  return {
    uvScale: [
      {
        range: "0–2",
        level: "Basso",
        color: "🟢",
        protection: "Nessuna necessaria",
        burnTimeFitzpatrick2: "60+ min",
      },
      {
        range: "3–5",
        level: "Moderato",
        color: "🟡",
        protection: "Occhiali, crema SPF 30",
        burnTimeFitzpatrick2: "30–45 min",
      },
      {
        range: "6–7",
        level: "Alto",
        color: "🟠",
        protection: "SPF 50, cappello, ombra 11–16",
        burnTimeFitzpatrick2: "15–25 min",
      },
      {
        range: "8–10",
        level: "Molto alto",
        color: "🔴",
        protection: "SPF 50+, evitare esposizione 10–16",
        burnTimeFitzpatrick2: "10–15 min",
      },
      {
        range: "11+",
        level: "Estremo",
        color: "🟣",
        protection: "Evitare uscita, SPF 50+, abiti coprenti",
        burnTimeFitzpatrick2: "<10 min",
      },
    ],
    fitzpatrickTypes: [
      { type: 1, description: "Pelle molto chiara, capelli rossi, lentiggini", burnMultiplier: 0.5 },
      { type: 2, description: "Pelle chiara, capelli biondi/rossi", burnMultiplier: 1.0 },
      { type: 3, description: "Pelle media, capelli castani", burnMultiplier: 1.5 },
      { type: 4, description: "Pelle olivastra, capelli scuri", burnMultiplier: 2.5 },
      { type: 5, description: "Pelle scura", burnMultiplier: 4.0 },
      { type: 6, description: "Pelle molto scura", burnMultiplier: 8.0 },
    ],
    altitudeNote:
      "UV aumenta ~10% ogni 1000m di quota. Riflessione neve: +80%. Riflessione acqua: +25%. Riflessione sabbia: +15%.",
    vitaminD: "15–20 min di esposizione braccia/viso senza protezione sufficiente per sintesi vitamina D (UV 3+).",
  };
}

function getConstructionData() {
  return {
    windLimits: [
      { activity: "Grù a torre", limitKmH: 50, note: "Fermo operazioni, braccio in bandiera" },
      { activity: "Ponteggi", limitKmH: 60, note: "Verifica ancoraggi, no salita" },
      { activity: "Lavori in quota", limitKmH: 40, note: "Imbracatura obbligatoria, no bordi" },
      { activity: "Getto calcestruzzo", limitKmH: 30, note: "Rischio rapida essicazione" },
      { activity: "Verniciatura", limitKmH: 20, note: "Spray disperdo, adesione ridotta" },
    ],
    concreteRules: {
      minTempC: 5,
      maxTempC: 35,
      rainRisk: "Coprire getto se pioggia prevista entro 4h",
      frostRisk: "No getto se T<0°C prevista nelle 24h successive",
      curingNote: "T 20°C: maturazione 28gg. T 10°C: 42gg. T 5°C: 56gg.",
    },
    soilConditions: {
      saturatedRisk: "soil_moisture > 0.35 → scavi instabili, rischio cedimento",
      frozenRisk: "T suolo < 0°C → lavorazione impossibile, attesa disgelo",
    },
  };
}

function getTourismData() {
  return {
    bestPeriods: {
      mare: { best: "giu–set", peak: "lug–ago", note: "SST > 22°C, UV alto" },
      montagna: { best: "giu–set", peak: "lug–ago", note: "Quota 1500–2500m ideale" },
      citta_arte: { best: "mar–mag, set–ott", peak: "apr, ott", note: "T miti, meno folla" },
      sci: { best: "dic–mar", peak: "gen–feb", note: "Migliore neve, freddo" },
      termale: { best: "ott–apr", peak: "nov–mar", note: "Ideale con T fredde" },
    },
    comfortIndex: {
      formula: "Basato su T percepita, UR, vento, UV",
      scale: [
        { range: "0–20", label: "Molto scomodo", action: "Evitare attività outdoor" },
        { range: "21–40", label: "Scomodo", action: "Limitare esposizione" },
        { range: "41–60", label: "Accettabile", action: "Attività outdoor con cautela" },
        { range: "61–80", label: "Confortevole", action: "Ideale per escursioni" },
        { range: "81–100", label: "Perfetto", action: "Condizioni ottimali" },
      ],
    },
  };
}

export async function handleReferenceGuidelines({ category }: { category: string }) {
  const start = Date.now();
  let data: any = {};

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
