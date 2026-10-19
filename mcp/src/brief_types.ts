import type { Macroarea } from "./model_tuning.js";
import type { ProbabilitaGiorno } from "./ensemble_probs.js";
import type { MetarStation } from "./italian_sources.js";

/** Stato di una fonte nel brief. */
export type SourceStatus = "ok" | "errore" | "parziale";

/** Payload di fonti esterne passato così com'è (radar DPC, adapter ARPA). */
export type PassThrough = Record<string, unknown>;

export interface NwpModelDay {
  tmax?: number;
  tmin?: number;
  precip?: number;
  probPrecip?: number;
}

export interface NwpDay {
  data: string;
  tmaxMedia: number | null;
  tmaxSpread: number | null;
  tmaxPesata: number | null;
  tminMedia: number | null;
  tminPesata: number | null;
  precipMediaMm: number | null;
  precipPesataMm: number | null;
  precipMaxMm: number | null;
  modelli: Record<string, NwpModelDay>;
  score: number;
  flags: string[];
}

export interface NwpSection {
  status: SourceStatus;
  modelli?: string[];
  macroarea?: Macroarea;
  pesi?: Record<string, number>;
  pesiStatici?: Record<string, number>;
  calibrazione?: {
    fonte: string | null;
    riferimento?: "metar" | "era5" | null;
    modelli?: Array<{ modello: string; n: number; maeC: number; fattore: number }>;
    nota?: string;
  };
  giorni?: NwpDay[];
  scoreOggi?: number | null;
  flagsOggi?: string[];
  scoreDomani?: number | null;
  flagsDomani?: string[];
  current?: ({ temperature_2m?: number } & Record<string, unknown>) | null;
  url?: string;
}

export interface AlertZoneOut {
  zona: string;
  regione: string | null;
  livelli: { idraulico: number; temporali: number; idrogeologico: number };
}

export interface AllerteSection {
  status: SourceStatus;
  error?: string;
  bollettino?: { nome: string | null; emissione: string | null };
  comune?: string | null;
  regione?: string | null;
  matching?: "comune" | "regione" | "nazionale";
  nota?: string;
  oggi?: AlertZoneOut[];
  domani?: AlertZoneOut[];
  allertaMaxOggi?: number | null;
  allertaMaxDomani?: number | null;
  comuneTrovato?: boolean;
}

export interface MetarStationOut extends MetarStation {
  distKm: number | null;
}

export interface MetarSection {
  status: SourceStatus;
  error?: string;
  stazioni?: MetarStationOut[];
}

export interface EnsembleSection {
  status: SourceStatus;
  error?: string;
  membri?: number;
  tempSpreadMaxC?: number | null;
  precipMeanTotMm?: number | null;
  precipSpreadMaxMm?: number | null;
  probabilita?: ProbabilitaGiorno[];
  modelli?: string[];
  nota?: string;
}

export interface BriefData {
  localita: {
    nome: string | null;
    regione: string | null;
    lat: number | undefined;
    lon: number | undefined;
    elevation: number | null | undefined;
    quotaImpostata: boolean;
  };
  fontiInterrogate: number;
  fontiOk: number;
  nwp: NwpSection;
  allerte: AllerteSection;
  radar: PassThrough & { status: string };
  metar: MetarSection;
  ensemble: EnsembleSection;
  arpaRegionale: PassThrough;
  divergenze: string[];
  confidenza: { livello: "alta" | "media" | "bassa"; motivi: string[] };
  errori: string[];
}
