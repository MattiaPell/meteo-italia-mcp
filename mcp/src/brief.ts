import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiGet, toToolResult, ApiResult } from "./http.js";
import { MeteoError } from "./errors.js";
import { haversine } from "./geo.js";
import { summarizeForecast, OpenMeteoRaw, ModelDaySummary } from "./summaries.js";
import { summarizeEnsemble, EnsembleHourly } from "./ensemble_probs.js";
import { getWeights, macroareaFor, weightedMean, Macroarea } from "./model_tuning.js";
import { dynamicWeights, skillsFromVerification, DynamicWeightResult, ModelSkill } from "./model_scoring.js";
import { fetchVerificationData, processModelVerification, DailyBag } from "./verification.js";
import { fetchMetarVerification, skillsFromMetar } from "./metar_verification.js";
import { normalizeModelId } from "./models.js";
import { parseMetarStation, RawMetar } from "./italian_sources.js";
import { fetchLatestBulletin, fetchRadarLatest, filterZones, maxLevel, BulletinResult, BulletinZone } from "./dpc.js";
import type {
  AllerteSection,
  BriefData,
  EnsembleSection,
  MetarSection,
  NwpDay,
  NwpSection,
  PassThrough,
  SourceStatus,
} from "./brief_types.js";
import { runBriefArpa as arpaVeneto } from "./regioni/arpav.js";
import { runBriefArpa as arpaTrentino } from "./regioni/meteotrentino.js";
import { runBriefArpa as arpaMarche } from "./regioni/arpa-marche.js";
import { runBriefArpa as arpaLombardia } from "./regioni/arpa-lombardia.js";
import { runBriefArpa as arpaFvg } from "./regioni/arpa-fvg.js";
import { runBriefArpa as arpaEr } from "./regioni/arpae.js";
import { runBriefArpa as arpaPiemonte } from "./regioni/arpa-piemonte.js";

// Aeroporti italiani con reporting METAR attivo (coordinate ARP). Usati per
// scegliere le stazioni di nowcasting più vicine al punto richiesto.
const ICAO_STATIONS: Array<{ icao: string; nome: string; lat: number; lon: number }> = [
  { icao: "LIRF", nome: "Roma Fiumicino", lat: 41.8, lon: 12.25 },
  { icao: "LIRA", nome: "Roma Ciampino", lat: 41.8, lon: 12.6 },
  { icao: "LIMC", nome: "Milano Malpensa", lat: 45.63, lon: 8.72 },
  { icao: "LIML", nome: "Milano Linate", lat: 45.44, lon: 9.28 },
  { icao: "LIME", nome: "Bergamo Orio al Serio", lat: 45.67, lon: 9.7 },
  { icao: "LIMF", nome: "Torino Caselle", lat: 45.2, lon: 7.65 },
  { icao: "LIMJ", nome: "Genova Sestri", lat: 44.41, lon: 8.84 },
  { icao: "LIPZ", nome: "Venezia Tessera", lat: 45.51, lon: 12.35 },
  { icao: "LIPH", nome: "Treviso", lat: 45.65, lon: 12.19 },
  { icao: "LIPX", nome: "Verona Villafranca", lat: 45.4, lon: 10.89 },
  { icao: "LIPQ", nome: "Ronchi dei Legionari", lat: 45.83, lon: 13.47 },
  { icao: "LIPE", nome: "Bologna", lat: 44.53, lon: 11.29 },
  { icao: "LIPR", nome: "Rimini", lat: 44.02, lon: 12.61 },
  { icao: "LIRQ", nome: "Firenze Peretola", lat: 43.81, lon: 11.2 },
  { icao: "LIRS", nome: "Pisa", lat: 43.68, lon: 10.39 },
  { icao: "LIRZ", nome: "Perugia", lat: 43.1, lon: 12.51 },
  { icao: "LIRN", nome: "Napoli Capodichino", lat: 40.88, lon: 14.29 },
  { icao: "LIBP", nome: "Pescara", lat: 42.43, lon: 14.18 },
  { icao: "LIBD", nome: "Bari", lat: 41.14, lon: 16.76 },
  { icao: "LIBR", nome: "Brindisi", lat: 40.66, lon: 17.95 },
  { icao: "LIEE", nome: "Cagliari Elmas", lat: 39.25, lon: 9.05 },
  { icao: "LIEO", nome: "Olbia", lat: 40.9, lon: 9.52 },
  { icao: "LIEA", nome: "Alghero", lat: 40.63, lon: 8.29 },
  { icao: "LICJ", nome: "Palermo", lat: 38.18, lon: 13.1 },
  { icao: "LICC", nome: "Catania Fontanarossa", lat: 37.47, lon: 15.07 },
  { icao: "LICT", nome: "Trapani Birgi", lat: 37.91, lon: 12.49 },
  { icao: "LICA", nome: "Lamezia Terme", lat: 38.91, lon: 16.24 },
  { icao: "LICR", nome: "Reggio Calabria", lat: 38.07, lon: 15.65 },
  { icao: "LICG", nome: "Pantelleria", lat: 36.82, lon: 11.97 },
  { icao: "LIMK", nome: "Comiso", lat: 36.99, lon: 14.6 },
  { icao: "LIQC", nome: "Lampedusa", lat: 35.5, lon: 12.62 },
  { icao: "LIBG", nome: "Taranto Grottaglie", lat: 40.52, lon: 17.4 },
];

const DEFAULT_MODELS = "italia_meteo_arpae_icon_2i,ecmwf_ifs025,icon_seamless,gfs_seamless,meteofrance_seamless";

function nearestIcao(lat: number, lon: number, n: number) {
  return ICAO_STATIONS.map((s) => ({
    ...s,
    distKm: Math.round(haversine({ lat, lon }, { lat: s.lat, lon: s.lon }) * 10) / 10,
  }))
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, n);
}

function sourceStatus(r: PromiseSettledResult<{ ok?: boolean } | null | undefined>): SourceStatus {
  if (r.status === "rejected") return "errore";
  const v = r.value;
  if (v == null || v.ok === false) return "errore";
  return "ok";
}

// ---------------------------------------------------------------------------
// ARPA adapter registry — ogni regione con API real-time esporta
// runBriefArpa(lat, lon) dal proprio file in regioni/.
// ---------------------------------------------------------------------------
interface ArpaAdapter {
  keywords: string[];
  execute(lat: number, lon: number): Promise<object>;
}

const ARPA_ADAPTERS: ArpaAdapter[] = [
  { keywords: ["veneto"], execute: arpaVeneto },
  { keywords: ["trentino", "p.a. trento", "p.a. bolzano", "bolzano", "trento"], execute: arpaTrentino },
  { keywords: ["marche"], execute: arpaMarche },
  { keywords: ["lombardia"], execute: arpaLombardia },
  { keywords: ["friuli", "fvg", "venezia giulia"], execute: arpaFvg },
  { keywords: ["emilia", "romagna", "emilia-romagna"], execute: arpaEr },
  { keywords: ["piemonte"], execute: arpaPiemonte },
];

export interface BriefParams {
  nome?: string;
  latitude?: number;
  longitude?: number;
  regione?: string;
  days?: number;
  models?: string;
  /** Quota (m) del punto di interesse: l'NWP viene riportato a questa quota. */
  elevation?: number;
}

export async function runBrief(
  params: BriefParams,
): Promise<{ ok: boolean; data?: BriefData; error?: string; elapsedMs: number }> {
  const { nome, latitude, longitude, regione, days = 3, models, elevation } = params;
  try {
    return await runBriefCore({ nome, latitude, longitude, regione, days, models, elevation });
  } catch (err) {
    // Contratto di runBrief: mai lanciare. Un errore upstream (geocoding,
    // network) torna come { ok: false, error } così la shape del tool resta
    // stabile e il client riceve structuredContent invece di un throw grezzo.
    // L'SDK MCP trasformerebbe comunque il throw in isError:true (verificato
    // con test), ma il messaggio strutturato è più azionabile.
    if (err instanceof MeteoError) {
      return { ok: false, error: `[${err.code}] ${err.message}`, elapsedMs: 0 };
    }
    throw err;
  }
}

function processNwpResult(
  nwpR: PromiseSettledResult<ApiResult>,
  chosenModels: string[],
  days: number,
  errori: string[],
  macroarea: Macroarea,
  pesi: Record<string, number>,
  calibrazione: DynamicWeightResult,
  calib: Calibrazione,
): NwpSection {
  // Pesi statici per macroarea: usati per la precipitazione, perché la
  // calibrazione misura solo l'errore di temperatura.
  const pesiStatici = getWeights(macroarea);
  let nwp: NwpSection = { status: sourceStatus(nwpR) };
  if (nwpR.status === "fulfilled" && nwpR.value.ok) {
    const raw = nwpR.value.data as OpenMeteoRaw & { current?: NwpSection["current"] };
    const summary = summarizeForecast(raw, chosenModels);
    const perDay: NwpDay[] = summary.days.slice(0, days).map((d) => {
      const tmaxs: number[] = [];
      const tmins: number[] = [];
      const precs: number[] = [];
      const byModel = (sel: (m: ModelDaySummary) => number | undefined) =>
        Object.fromEntries(Object.entries(d.models).map(([k, m]) => [k, sel(m)]));
      for (const m of Object.values(d.models)) {
        if (m.temp_max != null) tmaxs.push(m.temp_max);
        if (m.temp_min != null) tmins.push(m.temp_min);
        if (m.precip_sum != null) precs.push(m.precip_sum);
      }
      const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
      const spread = (xs: number[]) => (xs.length > 1 ? Math.max(...xs) - Math.min(...xs) : null);
      const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
      return {
        data: d.date,
        tmaxMedia: round1(mean(tmaxs)),
        tmaxSpread: round1(spread(tmaxs)),
        tmaxPesata: round1(
          weightedMean(
            byModel((m) => m.temp_max),
            pesi,
          ),
        ),
        tminMedia: round1(mean(tmins)),
        tminPesata: round1(
          weightedMean(
            byModel((m) => m.temp_min),
            pesi,
          ),
        ),
        precipMediaMm: round1(mean(precs)),
        precipPesataMm: round1(
          weightedMean(
            byModel((m) => m.precip_sum),
            pesi,
          ),
        ),
        precipMaxMm: round1(precs.length ? Math.max(...precs) : null),
        modelli: Object.fromEntries(
          Object.entries(d.models).map(([k, m]) => [
            k,
            { tmax: m.temp_max, tmin: m.temp_min, precip: m.precip_sum, probPrecip: m.precip_prob_max },
          ]),
        ),
        score: d.score,
        flags: d.flags,
      };
    });
    nwp = {
      status: "ok",
      modelli: chosenModels,
      macroarea,
      pesi: Object.fromEntries(chosenModels.map((k) => [k, pesi[normalizeModelId(k)] ?? 1])),
      pesiStatici: Object.fromEntries(chosenModels.map((k) => [k, pesiStatici[normalizeModelId(k)] ?? 1])),
      calibrazione: calibrazione.applicata
        ? {
            fonte:
              calib.fonte === "metar"
                ? `errore orario della temperatura degli ultimi ${METAR_CALIBRATION_DAYS} giorni vs ${calib.riferimento}`
                : `errore Tmax/Tmin degli ultimi ${CALIBRATION_DAYS} giorni vs ${calib.riferimento}`,
            riferimento: calib.fonte,
            modelli: calibrazione.dettaglio,
          }
        : { fonte: null, nota: "dati insufficienti: pesi statici per macroarea" },
      giorni: perDay,
      scoreOggi: perDay[0]?.score ?? null,
      flagsOggi: perDay[0]?.flags ?? [],
      scoreDomani: perDay[1]?.score ?? null,
      flagsDomani: perDay[1]?.flags ?? [],
      current: raw?.current ?? null,
      url: nwpR.value.url,
    };
  } else if (nwpR.status === "fulfilled") {
    errori.push(`Open-Meteo: ${nwpR.value.error ?? "errore"}`);
  }
  return nwp;
}

function processAllerteResult(
  allerteR: PromiseSettledResult<BulletinResult>,
  comune?: string,
  regioneEff?: string,
  errori: string[] = [],
): AllerteSection {
  let allerte: AllerteSection = { status: sourceStatus(allerteR) };
  if (allerteR.status === "fulfilled" && allerteR.value.ok) {
    const b = allerteR.value;
    const zoneOggi = comune ? filterZones(b.today, comune) : [];
    const zoneDomani = comune ? filterZones(b.tomorrow, comune) : [];
    const livelloComune = zoneOggi.length > 0 || zoneDomani.length > 0;
    let zoneOggiEff = zoneOggi;
    let zoneDomaniEff = zoneDomani;
    let matching: "comune" | "regione" | "nazionale" = livelloComune ? "comune" : "nazionale";
    if (!livelloComune && regioneEff) {
      zoneOggiEff = filterZones(b.today, undefined, regioneEff);
      zoneDomaniEff = filterZones(b.tomorrow, undefined, regioneEff);
      matching = "regione";
    }
    if (!zoneOggiEff.length && !zoneDomaniEff.length) {
      zoneOggiEff = b.today;
      zoneDomaniEff = b.tomorrow;
      matching = "nazionale";
    }
    const maxL = (zs: BulletinZone[]): number | null => {
      const m = maxLevel(zs);
      return m >= 0 ? m : null;
    };
    const nota =
      matching === "comune"
        ? null
        : matching === "regione"
          ? `Comune non individuato nel bollettino ('${comune ?? "non fornito"}'); allerta a livello regione '${regioneEff}'.`
          : `Né comune né regione ('${regioneEff ?? "sconosciuta"}') individuati; riportato il massimo nazionale.`;
    allerte = {
      status: "ok",
      bollettino: { nome: b.nome, emissione: b.emissione },
      comune: comune ?? null,
      regione: regioneEff ?? null,
      matching,
      ...(nota ? { nota } : {}),
      oggi: zoneOggiEff.map((z) => ({ zona: z.zona, regione: z.regione, livelli: z.livelli })),
      domani: zoneDomaniEff.map((z) => ({ zona: z.zona, regione: z.regione, livelli: z.livelli })),
      allertaMaxOggi: maxL(zoneOggiEff),
      allertaMaxDomani: maxL(zoneDomaniEff),
      comuneTrovato: livelloComune,
    };
  } else if (allerteR.status === "fulfilled") {
    allerte = { status: "errore", error: allerteR.value?.error ?? "bollettino non disponibile" };
    errori.push("Allerte DPC non disponibili");
  }
  return allerte;
}

function processMetarResult(
  metarR: PromiseSettledResult<ApiResult>,
  nwpCurrentTemp: number | null,
  icaoList: Array<{ icao: string; distKm: number }>,
): MetarSection {
  let metar: MetarSection = { status: sourceStatus(metarR) };
  if (metarR.status === "fulfilled" && metarR.value.ok) {
    const payload = metarR.value.data as { data?: unknown } | unknown[] | null;
    const found = Array.isArray(payload) ? payload : ((payload as { data?: unknown } | null)?.data ?? []);
    const list = (Array.isArray(found) ? found : []) as Array<RawMetar | null>;
    const icaoMap = new Map(icaoList.map((i) => [i.icao, i.distKm]));
    metar = {
      status: "ok",
      stazioni: list
        .filter((s): s is RawMetar => !!s)
        .map((s) => {
          const parsed = parseMetarStation(s, nwpCurrentTemp ?? undefined);
          const dist = icaoMap.get(parsed.icao ?? "") ?? null;
          return { ...parsed, distKm: dist };
        }),
    };
  } else if (metarR.status === "fulfilled") {
    metar = { status: "errore", error: metarR.value.error };
  }
  return metar;
}

function processEnsembleResult(ensembleR: PromiseSettledResult<ApiResult>): EnsembleSection {
  let ensemble: EnsembleSection = { status: sourceStatus(ensembleR) };
  if (ensembleR.status === "fulfilled" && ensembleR.value.ok) {
    const summary = summarizeEnsemble((ensembleR.value.data as { hourly?: EnsembleHourly } | null)?.hourly ?? {});
    if (!summary) {
      return { status: "errore", error: "ensemble senza membri utilizzabili" };
    }
    ensemble = {
      status: "ok",
      membri: summary.membri,
      tempSpreadMaxC: summary.tempSpreadMaxC,
      precipMeanTotMm: summary.precipMeanTotMm,
      precipSpreadMaxMm: summary.precipSpreadMaxMm,
      probabilita: summary.probabilita,
      modelli: ["ecmwf_ifs025"],
      nota: "Probabilità = quota di membri ECMWF ENS sopra soglia (pioggia ≥1/≥10 mm, Tmin ≤0°C, Tmax ≥35°C, raffica ≥60 km/h). Spread = deviazione standard tra i membri. ICON è deterministico.",
    };
  } else if (ensembleR.status === "fulfilled") {
    ensemble = { status: "errore", error: ensembleR.value?.error };
  }
  return ensemble;
}

function getNwpDivergences(nwp: NwpSection): string[] {
  const divergenze: string[] = [];
  const day1 = nwp?.giorni?.[0];
  if (day1?.tmaxSpread != null && day1.tmaxSpread > 3) {
    divergenze.push(`Modelli NWP divergono su T max oggi: spread ${day1.tmaxSpread}°C (>3°C)`);
  }
  return divergenze;
}

function getMetarDivergences(metar: MetarSection): string[] {
  const divergenze: string[] = [];
  if (metar?.stazioni?.length) {
    for (const st of metar.stazioni) {
      const scarto = st?.decodedVsNwp?.tempScarto;
      if (scarto != null && scarto > 2) {
        divergenze.push(`METAR ${st.icao} (${st.distKm}km): T osservata scarta di ${scarto}°C dal NWP corrente (>2°C)`);
      }
      if (st?.decodedVsNwp?.visFlag) {
        divergenze.push(`METAR ${st.icao}: visibilità <2000m non risolta dal NWP`);
      }
    }
  }
  return divergenze;
}

function getAllerteDivergences(allerte: AllerteSection, nwp: NwpSection): string[] {
  const divergenze: string[] = [];
  const day1 = nwp?.giorni?.[0];
  if (
    allerte?.allertaMaxOggi != null &&
    allerte.allertaMaxOggi >= 1 &&
    day1?.precipMaxMm != null &&
    day1.precipMaxMm < 5
  ) {
    divergenze.push(
      `Allerta PC ≥ gialla ma precipitazione NWP max ${day1.precipMaxMm}mm: verificare con radar/nowcasting`,
    );
  }
  return divergenze;
}

function getEnsembleDivergences(ensemble: EnsembleSection): string[] {
  const divergenze: string[] = [];
  if (ensemble?.tempSpreadMaxC != null && ensemble.tempSpreadMaxC > 4) {
    divergenze.push(`Spread ensemble T elevato: ${ensemble.tempSpreadMaxC}°C`);
  }
  return divergenze;
}

function computeDivergences(nwp: NwpSection, metar: MetarSection, allerte: AllerteSection, ensemble: EnsembleSection) {
  return [
    ...getNwpDivergences(nwp),
    ...getMetarDivergences(metar),
    ...getAllerteDivergences(allerte, nwp),
    ...getEnsembleDivergences(ensemble),
  ];
}

async function resolveLocation(
  nome?: string,
  latitude?: number,
  longitude?: number,
  regione?: string,
): Promise<{
  ok: boolean;
  error?: string;
  lat?: number;
  lon?: number;
  comune?: string;
  regioneEff?: string;
  elevation?: number | null;
}> {
  let lat = latitude;
  let lon = longitude;
  let regioneEff = regione;
  let comune = nome;
  let elevation: number | null = null;
  if (lat == null || lon == null) {
    if (!nome) {
      return { ok: false, error: "Passa nome località oppure latitude+longitude." };
    }
    const g = await apiGet("https://geocoding-api.open-meteo.com/v1/search", {
      name: nome,
      count: 10,
      language: "it",
      format: "json",
    });
    const results = (g.data as { results?: GeoResult[] } | null)?.results ?? [];
    const it = results.filter((x) => x.country_code === "IT");
    if (!it.length) {
      return { ok: false, error: `Località '${nome}' non trovata in Italia.` };
    }
    lat = it[0].latitude;
    lon = it[0].longitude;
    elevation = it[0].elevation ?? null;
    comune = it[0].name;
    regioneEff = regioneEff ?? it[0].admin1 ?? undefined;
  }
  return { ok: true, lat, lon, comune, regioneEff, elevation };
}

function fetchNwpData(lat: number, lon: number, chosenModels: string[], days: number, elevation?: number) {
  return apiGet("https://api.open-meteo.com/v1/forecast", {
    latitude: lat,
    longitude: lon,
    // Con `elevation` Open-Meteo riporta la temperatura alla quota indicata (downscaling).
    ...(elevation != null ? { elevation } : {}),
    models: chosenModels,
    hourly: [
      "temperature_2m",
      "precipitation",
      "weather_code",
      "cape",
      "wind_gusts_10m",
      "wind_speed_10m",
      "wind_direction_10m",
      "freezing_level_height",
      "snowfall",
      "boundary_layer_height",
      "visibility",
      "convective_inhibition",
    ],
    daily: [
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_sum",
      "precipitation_probability_max",
      "wind_gusts_10m_max",
      "uv_index_max",
      "weather_code",
    ],
    current: ["temperature_2m", "weather_code", "wind_speed_10m", "relative_humidity_2m"],
    timezone: "Europe/Rome",
    forecast_days: days,
  });
}

function fetchMetarData(icaoList: { icao: string }[]) {
  return apiGet("https://aviationweather.gov/api/data/metar", {
    ids: icaoList.map((s) => s.icao).join(","),
    format: "json",
  });
}

/** Finestra (giorni) per misurare l'errore recente dei modelli vs ERA5. ERA5 ha ~5 giorni di ritardo: i più recenti restano vuoti. */
const CALIBRATION_DAYS = 14;
/** Finestra (giorni) per la verifica contro i METAR, e distanza massima della stazione dal punto. */
const METAR_CALIBRATION_DAYS = 5;
const METAR_MAX_KM = 50;
/** Giorni equivalenti minimi (ore accoppiate / 24) per fidarsi della skill misurata sui METAR. */
const METAR_MIN_DAYS = 3;

interface GeoResult {
  country_code?: string;
  latitude: number;
  longitude: number;
  elevation?: number;
  name?: string;
  admin1?: string;
}

interface Calibrazione {
  fonte: "metar" | "era5" | null;
  riferimento: string | null;
  skills: ModelSkill[];
  minN: number;
}

const NESSUNA_CALIBRAZIONE: Calibrazione = { fonte: null, riferimento: null, skills: [], minN: 5 };

/**
 * Skill recente dei modelli sulla località. Preferisce i METAR della stazione
 * vicina (osservazione reale); se mancano o sono insufficienti ripiega su ERA5.
 */
async function fetchCalibration(
  lat: number,
  lon: number,
  models: string[],
  station?: { icao: string; lat: number; lon: number; distKm: number },
): Promise<Calibrazione> {
  if (station && station.distKm <= METAR_MAX_KM) {
    try {
      const v = await fetchMetarVerification(station, models, METAR_CALIBRATION_DAYS);
      const skills = v ? skillsFromMetar(v) : [];
      if (skills.filter((s) => s.n >= METAR_MIN_DAYS).length >= 2) {
        return {
          fonte: "metar",
          riferimento: `METAR ${station.icao} (${station.distKm} km)`,
          skills,
          minN: METAR_MIN_DAYS,
        };
      }
    } catch {
      // ripiega su ERA5
    }
  }
  const { forecastRes, archiveRes } = await fetchVerificationData(lat, lon, CALIBRATION_DAYS, models);
  if (!forecastRes.ok || !archiveRes.ok) return NESSUNA_CALIBRAZIONE;
  const { verification } = processModelVerification(models, forecastRes.data as DailyBag, archiveRes.data as DailyBag);
  return { fonte: "era5", riferimento: "ERA5 sulla località", skills: skillsFromVerification(verification), minN: 5 };
}

function fetchEnsembleData(lat: number, lon: number, days: number) {
  return apiGet("https://ensemble-api.open-meteo.com/v1/ensemble", {
    latitude: lat,
    longitude: lon,
    models: ["ecmwf_ifs025"],
    hourly: ["temperature_2m", "precipitation", "wind_gusts_10m"],
    timezone: "Europe/Rome",
    forecast_days: days,
  });
}

async function fetchArpaData(lat: number, lon: number, regioneEff?: string): Promise<object> {
  const regioneNorm = (regioneEff ?? "").toLowerCase();
  const adapter = ARPA_ADAPTERS.find((a) => a.keywords.some((k) => regioneNorm.includes(k)));
  if (adapter) return adapter.execute(lat, lon);
  return {
    ok: false,
    agenzia: null,
    nonCoperto: `Nessun adapter ARPA real-time per '${regioneEff ?? "regione sconosciuta"}'. Coperti: Veneto (ARPAV), Trentino (Meteotrentino), Marche (AMAP), Lombardia (ARPA Lombardia), Friuli Venezia Giulia (ARPA FVG/OSMER), Emilia-Romagna (ARPAE), Piemonte (ARPA Piemonte). Usa METAR + radar come osservazioni.`,
  };
}

function runBriefCore({
  nome,
  latitude,
  longitude,
  regione,
  days,
  models,
  elevation: elevationOverride,
}: {
  nome?: string;
  latitude?: number;
  longitude?: number;
  regione?: string;
  days: number;
  models?: string;
  elevation?: number;
}): Promise<{ ok: boolean; data?: BriefData; error?: string; elapsedMs: number }> {
  return (async () => {
    const start = Date.now();
    const errori: string[] = [];

    // 1) Posizione
    const loc = await resolveLocation(nome, latitude, longitude, regione);
    if (!loc.ok) {
      return { ok: false, error: loc.error, elapsedMs: Date.now() - start };
    }
    const { lat, lon, comune, regioneEff } = loc;
    const elevation = elevationOverride ?? loc.elevation;

    const chosenModels = (models ?? DEFAULT_MODELS)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const icaoList = nearestIcao(lat!, lon!, 3);

    const nwpTask = fetchNwpData(lat!, lon!, chosenModels, days, elevationOverride);
    const allerteTask = fetchLatestBulletin();
    const radarTask = fetchRadarLatest("VMI");
    const metarTask = fetchMetarData(icaoList);
    const ensembleTask = fetchEnsembleData(lat!, lon!, days);
    const arpaTask = fetchArpaData(lat!, lon!, regioneEff);
    const normalizedModels = chosenModels.map(normalizeModelId);
    // Non è una fonte: se fallisce restano i pesi statici.
    const calibTask = fetchCalibration(lat!, lon!, normalizedModels, icaoList[0]).catch(() => NESSUNA_CALIBRAZIONE);

    const [nwpR, allerteR, radarR, metarR, ensembleR, arpaR] = await Promise.allSettled([
      nwpTask,
      allerteTask,
      radarTask,
      metarTask,
      ensembleTask,
      arpaTask,
    ]);

    const macroarea = macroareaFor(lat!, lon!, elevation ?? undefined);
    const calib = await calibTask;
    const calibrazione = dynamicWeights(getWeights(macroarea), calib.skills, { minN: calib.minN });
    const nwp = processNwpResult(
      nwpR,
      chosenModels,
      days,
      errori,
      macroarea,
      calibrazione.weights,
      calibrazione,
      calib,
    );

    const allerte = processAllerteResult(allerteR, comune, regioneEff, errori);

    // Radar
    const radar: BriefData["radar"] =
      radarR.status === "fulfilled"
        ? { ...radarR.value, status: radarR.value.ok ? "ok" : "errore" }
        : { status: "errore" };

    // METAR
    const nwpCurrentTemp: number | null = nwp.current?.temperature_2m ?? null;
    const metar = processMetarResult(metarR, nwpCurrentTemp, icaoList);

    // Ensemble spread (ECMWF only — ICON has no public ensemble on Open-Meteo)
    const ensemble = processEnsembleResult(ensembleR);

    const arpa: PassThrough & { ok?: boolean } =
      arpaR.status === "fulfilled" ? (arpaR.value as PassThrough & { ok?: boolean }) : { status: "errore" };

    const divergenze = computeDivergences(nwp, metar, allerte, ensemble);

    const nFontiOk = [
      nwp.status,
      allerte.status,
      radar.status,
      metar.status,
      ensemble.status,
      arpa?.ok ? "ok" : "x",
    ].filter((s) => s === "ok").length;

    // Conteggio fonti interrogate calcolato dal numero effettivo di task
    // lanciati: resta corretto se in futuro si aggiungono/rimuovono fonti.
    const fontiInterrogate = [nwpR, allerteR, radarR, metarR, ensembleR, arpaR].length;

    const data: BriefData = {
      localita: {
        nome: comune ?? null,
        regione: regioneEff ?? null,
        lat,
        lon,
        elevation,
        quotaImpostata: elevationOverride != null,
      },
      fontiInterrogate,
      fontiOk: nFontiOk,
      nwp,
      allerte,
      radar,
      metar,
      ensemble,
      arpaRegionale: arpa,
      divergenze,
      confidenza: computeConfidence({ nwp: nwp.status, allerte: allerte.status, metar: metar.status }, divergenze),
      errori,
    };
    return { ok: nwp.status === "ok", data, elapsedMs: Date.now() - start };
  })();
}

export interface Confidenza {
  livello: "alta" | "media" | "bassa";
  motivi: string[];
}

/**
 * Confidenza calcolata dal server: le fonti core sono NWP, allerte e METAR.
 * Tutte ok e nessuna divergenza → alta; una fonte core mancante o divergenze
 * presenti → media; NWP assente o due fonti core mancanti → bassa.
 */
export function computeConfidence(
  fonti: { nwp: string; allerte: string; metar: string },
  divergenze: string[],
): Confidenza {
  const motivi: string[] = [];
  const mancanti = (Object.entries(fonti) as Array<[string, string]>).filter(([, st]) => st !== "ok").map(([k]) => k);
  for (const k of mancanti) motivi.push(`fonte ${k} non disponibile`);
  if (divergenze.length) motivi.push(`${divergenze.length} divergenza/e tra fonti`);
  let livello: Confidenza["livello"] = "alta";
  if (mancanti.length || divergenze.length) livello = "media";
  if (fonti.nwp !== "ok" || mancanti.length >= 2) livello = "bassa";
  return { livello, motivi };
}

export function registerBrief(server: McpServer) {
  server.registerTool(
    "meteo_brief",
    {
      title: "Brief Meteo Multi-Fonte (default per qualsiasi località italiana)",
      description:
        "UNICO tool da chiamare per una richiesta meteo su una località italiana: aggrega in parallelo (1) previsione multi-modello Open-Meteo con consensus pesato (per macroarea, calibrato sull'errore recente dei modelli per la temperatura, contro METAR vicini o ERA5) e spread, (2) allerte Protezione Civile per il comune, (3) stato radar DPC, (4) METAR delle 3 stazioni ICAO più vicine, (5) osservazioni/bollettino ARPA regionale quando disponibili (Veneto, Trentino, Marche, Lombardia, Friuli Venezia Giulia, Emilia-Romagna, Piemonte), (6) probabilità giornaliere da ensemble ECMWF (pioggia ≥1/≥10 mm, gelo, caldo estremo, raffica ≥60 km/h) e spread. Ogni fonte riporta il suo stato (ok/errore/non coperta) e le divergenze tra fonti sono calcolate automaticamente. Usa questo PRIMA di qualsiasi approfondimento con i tool singoli.",
      inputSchema: {
        nome: z
          .string()
          .optional()
          .describe("Nome località (es. 'Rovigo'). Se manca latitude/longitude, viene geocodificata in Italia."),
        latitude: z.coerce.number().optional().describe("Lat (salta geocoding)"),
        longitude: z.coerce.number().optional().describe("Lon (salta geocoding)"),
        regione: z
          .string()
          .optional()
          .describe("Regione (es. 'Veneto') — attiva l'adapter ARPA regionale. Auto da geocoding se possibile."),
        days: z.coerce.number().int().min(1).max(7).default(3).describe("Giorni di previsione (1-7)"),
        models: z.string().optional().describe(`Lista modelli Open-Meteo, default ${DEFAULT_MODELS}`),
        elevation: z.coerce
          .number()
          .min(-100)
          .max(5000)
          .optional()
          .describe(
            "Quota in metri del punto di interesse (es. rifugio, malga): le temperature sono riportate a questa quota. Se omessa si usa la quota del terreno del punto.",
          ),
      },
      outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ nome, latitude, longitude, regione, days, models, elevation }) => {
      const r = await runBrief({ nome, latitude, longitude, regione, days, models, elevation });
      if (!r.ok && !r.data) {
        return toToolResult({
          ok: false,
          url: "mcp://meteo_brief",
          status: 0,
          data: null,
          error: r.error ?? "brief non disponibile",
          elapsedMs: r.elapsedMs,
        });
      }
      return toToolResult({
        ok: r.ok,
        url: "mcp://meteo_brief",
        status: 200,
        data: r.data,
        elapsedMs: r.elapsedMs,
      });
    },
  );
}
