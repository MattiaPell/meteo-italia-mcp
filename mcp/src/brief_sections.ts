/** Elaborazione delle singole sezioni del brief (NWP, allerte, METAR, ensemble) e delle divergenze tra fonti. */
import type { ApiResult } from "./http.js";
import type { Calibrazione } from "./brief.js";
import { summarizeForecast, OpenMeteoRaw, ModelDaySummary } from "./summaries.js";
import { summarizeEnsemble, EnsembleHourly } from "./ensemble_probs.js";
import { getWeights, weightedMean, Macroarea } from "./model_tuning.js";
import { DynamicWeightResult } from "./model_scoring.js";
import { normalizeModelId } from "./models.js";
import { parseMetarStation, RawMetar } from "./italian_sources.js";
import { filterZones, maxLevel, BulletinResult, BulletinZone } from "./dpc.js";
import type { AllerteSection, EnsembleSection, MetarSection, NwpDay, NwpSection, SourceStatus } from "./brief_types.js";

/** Finestra (giorni) per misurare l'errore recente dei modelli vs ERA5. ERA5 ha ~5 giorni di ritardo: i più recenti restano vuoti. */
export const CALIBRATION_DAYS = 14;
/** Finestra (giorni) per la verifica contro i METAR. */
export const METAR_CALIBRATION_DAYS = 5;

function sourceStatus(r: PromiseSettledResult<{ ok?: boolean } | null | undefined>): SourceStatus {
  if (r.status === "rejected") return "errore";
  const v = r.value;
  if (v == null || v.ok === false) return "errore";
  return "ok";
}

export function processNwpResult(
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

export function processAllerteResult(
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

export function processMetarResult(
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

export function processEnsembleResult(ensembleR: PromiseSettledResult<ApiResult>): EnsembleSection {
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

export function computeDivergences(
  nwp: NwpSection,
  metar: MetarSection,
  allerte: AllerteSection,
  ensemble: EnsembleSection,
) {
  return [
    ...getNwpDivergences(nwp),
    ...getMetarDivergences(metar),
    ...getAllerteDivergences(allerte, nwp),
    ...getEnsembleDivergences(ensemble),
  ];
}
