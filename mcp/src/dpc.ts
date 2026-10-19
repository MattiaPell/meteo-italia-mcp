import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiGet, apiPostJson, toToolResult, ApiResult } from "./http.js";

// ---------------------------------------------------------------------------
// Protezione Civile — bollettino di criticità nazionale
//
// Fonte ufficiale verificata (2026-07): repository GitHub pcm-dpc. L'host
// api.protezionecivile.gov.it non esiste più (DNS morto). Il bollettino è
// pubblicato una volta al giorno (~14:30) più eventuali aggiornamenti serali.
// Ogni emissione produce:
//   files/<STAMP>.json                  — metadati + descrizioni HTML
//   files/geojson/<STAMP>_today.json    — livelli per zona di allerta (oggi)
//   files/geojson/<STAMP>_tomorrow.json — livelli per zona (domani)
// ---------------------------------------------------------------------------

const GITHUB_API = "https://api.github.com/repos/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica";
const GITHUB_RAW =
  "https://raw.githubusercontent.com/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica/master/files";

export interface BulletinZone {
  zona: string;
  regione: string | null;
  comuni: string[];
  normalizedComuni: Set<string>;
  livelli: {
    idraulico: number;
    temporali: number;
    idrogeologico: number;
  };
  testi: {
    idraulico: string;
    temporali: string;
    idrogeologico: string;
  };
  mappa: string;
}

export interface BulletinResult {
  ok: boolean;
  stamp: string | null;
  nome: string | null;
  emissione: string | null;
  today: BulletinZone[];
  tomorrow: BulletinZone[];
  error?: string;
}

/** "Ordinaria criticità per rischio temporali / Allerta gialla" → 1 */
export function alertLevelFromText(text: string): number {
  const t = text.toLowerCase();
  if (/allerta\s+rossa/.test(t)) return 3;
  if (/allerta\s+arancione/.test(t)) return 2;
  if (/allerta\s+gialla/.test(t)) return 1;
  return 0;
}

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse the bulletin HTML description into { zona normalizzata → regione }. */
export function extractZoneRegionMap(html: string): Map<string, string> {
  const map = new Map<string, string>();
  // Handle both <b> and <strong> tags (DPC format may change)
  const re = /<(?:b|strong)>([^<]{2,40})<\/(?:b|strong)>\s*:\s*([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const regione = m[1].trim();
    if (/CRITICA|RISCHIO|ALLERTA/i.test(regione)) continue;
    for (const zona of m[2].split(",")) {
      const z = zona.trim().replace(/\.$/, "");
      if (z) map.set(normalizeName(z), regione);
    }
  }
  return map;
}

interface BulletinMeta {
  name?: string;
  date?: string;
  today?: { html_descrition?: unknown };
  tomorrow?: { html_descrition?: unknown };
}

interface ZoneFeature {
  properties?: Record<string, unknown>;
}

function parseZoneGeojson(
  fc: { features?: ZoneFeature[] } | null | undefined,
  regionByZone: Map<string, string>,
): BulletinZone[] {
  const features = fc?.features ?? [];
  const zones: BulletinZone[] = [];
  for (const f of features) {
    const p: Record<string, unknown> = f?.properties ?? {};
    const zona = String(p["Nome zona"] ?? "");
    if (!zona) continue;
    const tIdr = String(p["Per rischio idraulico"] ?? "");
    const tTemp = String(p["Per rischio temporali"] ?? "");
    const tGeo = String(p["Per rischio idrogeologico"] ?? "");
    const comuni = p["Comuni"];
    const comuniArray = Array.isArray(comuni) ? comuni.map(String) : [];
    zones.push({
      zona,
      regione: regionByZone.get(normalizeName(zona)) ?? null,
      comuni: comuniArray,
      normalizedComuni: new Set(comuniArray.map(normalizeName)),
      livelli: {
        idraulico: alertLevelFromText(tIdr),
        temporali: alertLevelFromText(tTemp),
        idrogeologico: alertLevelFromText(tGeo),
      },
      testi: { idraulico: tIdr, temporali: tTemp, idrogeologico: tGeo },
      mappa: String(p["Rappresentata nella mappa"] ?? ""),
    });
  }
  return zones;
}

/** Resolve the latest bulletin stamp via the GitHub git tree (cached 30 min). */
async function resolveLatestStamp(): Promise<string | null> {
  const tree = await apiGet(`${GITHUB_API}/git/trees/master`, { recursive: "1" });
  if (!tree.ok) return null;
  const stamps: string[] = [];
  for (const node of (tree.data as { tree?: Array<{ path?: string }> } | null)?.tree ?? []) {
    const p: string = node?.path ?? "";
    const m = p.match(/^files\/(\d{8}_\d{4})\.json$/);
    if (m) stamps.push(m[1]);
  }
  stamps.sort();
  return stamps.at(-1) ?? null;
}

/** Fetch and parse the latest DPC criticality bulletin. */
export async function fetchLatestBulletin(): Promise<BulletinResult> {
  const stamp = await resolveLatestStamp();
  if (!stamp) {
    return {
      ok: false,
      stamp: null,
      nome: null,
      emissione: null,
      today: [],
      tomorrow: [],
      error: "Impossibile risolvere l'ultimo bollettino dal repository GitHub pcm-dpc",
    };
  }
  const meta = await apiGet(`${GITHUB_RAW}/${stamp}.json`, {});
  if (!meta.ok) {
    return {
      ok: false,
      stamp,
      nome: null,
      emissione: null,
      today: [],
      tomorrow: [],
      error: `Bollettino ${stamp} non raggiungibile (HTTP ${meta.status})`,
    };
  }
  const metaData = meta.data as BulletinMeta | null;
  const regionByZone = new Map<string, string>();
  for (const day of ["today", "tomorrow"] as const) {
    const html = metaData?.[day]?.html_descrition;
    if (typeof html === "string") {
      for (const [z, r] of extractZoneRegionMap(html)) {
        if (!regionByZone.has(z)) regionByZone.set(z, r);
      }
    }
  }
  const out: BulletinResult = {
    ok: true,
    stamp,
    nome: metaData?.name ?? null,
    emissione: metaData?.date ?? null,
    today: [],
    tomorrow: [],
  };
  const days = ["today", "tomorrow"] as const;
  const results = await Promise.all(days.map((day) => apiGet(`${GITHUB_RAW}/geojson/${stamp}_${day}.json`, {})));
  days.forEach((day, i) => {
    const gj = results[i];
    if (gj.ok) out[day] = parseZoneGeojson(gj.data as { features?: ZoneFeature[] } | null, regionByZone);
  });
  if (!out.today.length && !out.tomorrow.length) {
    out.ok = false;
    out.error = `GeoJSON zone non disponibili per il bollettino ${stamp}`;
  }
  return out;
}

export function filterZones(zones: BulletinZone[], comune?: string, regione?: string): BulletinZone[] {
  let out = zones;
  if (regione) {
    // Normalizza anche i trattini e confronta in entrambe le direzioni: il
    // geocoder può dare "Friuli-Venezia Giulia", il bollettino DPC
    // "Friuli Venezia Giulia" (o admin1 più lungo tipo ".../Südtirol").
    const r = normalizeName(regione).replace(/-/g, " ");
    out = out.filter((z) => {
      if (!z.regione) return false;
      const zr = normalizeName(z.regione).replace(/-/g, " ");
      return zr.includes(r) || r.includes(zr);
    });
  }
  if (comune) {
    const c = normalizeName(comune);
    out = out.filter((z) => z.normalizedComuni.has(c));
  }
  return out;
}

export function maxLevel(zones: BulletinZone[]): number {
  return zones.reduce((m, z) => Math.max(m, z.livelli.idraulico, z.livelli.temporali, z.livelli.idrogeologico), -1);
}

// ---------------------------------------------------------------------------
// Radar-DPC REST API — https://dpc-radar.readthedocs.io/it/latest/api.html
// Verificata live 2026-07-21. La piattaforma è stata aggiornata il 12-01-2026:
// la risposta di findLastProductByType è { total, lastProducts: [{ time }] },
// NON più un campo time al top-level. Il download restituisce una pre-signed
// URL S3 (GeoTIFF) con scadenza ~300s. Il parametro/header `origin` è
// documentato come obbligatorio.
// ---------------------------------------------------------------------------

export const DPC_RADAR_PRODUCTS = [
  "VMI",
  "SRI",
  "SRT1",
  "IR_108",
  "TEMP",
  "CUM3",
  "CUM6",
  "CUM12",
  "CUM24",
  "CAPPI_1",
  "CAPPI_2",
  "CAPPI_3",
  "CAPPI_4",
  "CAPPI_5",
  "CAPPI_6",
  "CAPPI_7",
  "CAPPI_8",
  "CAPPI_9",
  "CAPPI_10",
  "VIL",
  "ETM",
  "POH",
  "SITES",
] as const;

const RADAR_BASE = "https://radar-api.protezionecivile.it";
const RADAR_ORIGIN = "https://radar.protezionecivile.it";

export interface RadarLatest {
  ok: boolean;
  product: string;
  time: number | null;
  timeIso: string | null;
  period: string | null;
  ageMinutes: number | null;
  error?: string;
}

export async function fetchRadarLatest(product: string): Promise<RadarLatest> {
  const r = await apiGet(
    `${RADAR_BASE}/findLastProductByType`,
    {
      type: product,
      origin: RADAR_ORIGIN,
    },
    { headers: { origin: RADAR_ORIGIN, referer: `${RADAR_ORIGIN}/` } },
  );
  if (!r.ok) {
    return { ok: false, product, time: null, timeIso: null, period: null, ageMinutes: null, error: r.error };
  }
  const last = (r.data as { lastProducts?: Array<{ time?: unknown; period?: string }> } | null)?.lastProducts?.[0];
  const time = typeof last?.time === "number" ? last.time : null;
  return {
    ok: time != null,
    product,
    time,
    timeIso: time != null ? new Date(time).toISOString() : null,
    period: last?.period ?? null,
    ageMinutes: time != null ? Math.round((Date.now() - time) / 60000) : null,
    error: time != null ? undefined : `Nessun prodotto ${product} disponibile`,
  };
}

export async function fetchRadarDownload(product: string, time: number): Promise<ApiResult> {
  return apiPostJson(
    `${RADAR_BASE}/downloadProduct?origin=${encodeURIComponent(RADAR_ORIGIN)}`,
    { productType: product, productDate: time },
    { headers: { origin: RADAR_ORIGIN, referer: `${RADAR_ORIGIN}/` } },
  );
}

// ---------------------------------------------------------------------------

export async function handlePcAllerte({
  comune,
  regione,
  day,
}: {
  comune?: string;
  regione?: string;
  day: "today" | "tomorrow" | "both";
}) {
  const start = Date.now();
  const b = await fetchLatestBulletin();
  if (!b.ok) {
    return toToolResult({
      ok: false,
      url: GITHUB_RAW,
      status: 0,
      data: null,
      error: `${b.error} — consulta https://mappe.protezionecivile.gov.it/it/mappe-rischi/bollettino-di-criticita/`,
      elapsedMs: Date.now() - start,
    });
  }
  const pick = (zones: BulletinZone[]) =>
    zones.map((z) => ({
      zona: z.zona,
      regione: z.regione,
      livelli: z.livelli,
      allertaMax: Math.max(z.livelli.idraulico, z.livelli.temporali, z.livelli.idrogeologico),
      comuniMatch: comune ? z.comuni.length : undefined,
    }));
  const todayZones = day !== "tomorrow" ? filterZones(b.today, comune, regione) : [];
  const tomorrowZones = day !== "today" ? filterZones(b.tomorrow, comune, regione) : [];
  const matched = comune
    ? [...b.today, ...b.tomorrow].some((z) => z.normalizedComuni.has(normalizeName(comune)))
    : true;
  const data = {
    fonte: "DPC Bollettino di Criticità (GitHub pcm-dpc, CC-BY)",
    bollettino: { nome: b.nome, emissione: b.emissione, stamp: b.stamp },
    filtro: { comune: comune ?? null, regione: regione ?? null, comuneTrovato: comune ? matched : null },
    allertaMaxOggi: todayZones.length ? maxLevel(todayZones) : null,
    allertaMaxDomani: tomorrowZones.length ? maxLevel(tomorrowZones) : null,
    zoneOggi: pick(todayZones),
    zoneDomani: pick(tomorrowZones),
    nota:
      comune && !matched
        ? `Comune '${comune}' non trovato in nessuna zona di allerta: verifica il nome esatto (es. 'Reggio di Calabria').`
        : "Livelli: 0=verde/nessuna, 1=gialla, 2=arancione, 3=rossa. Per il rischio temporali il rosso non è previsto.",
  };
  return toToolResult({
    ok: true,
    url: `${GITHUB_RAW}/${b.stamp}.json`,
    status: 200,
    data,
    elapsedMs: Date.now() - start,
  });
}

export async function handleDpcRadar({ product, download }: { product: string; download: boolean }) {
  const start = Date.now();
  const latest = await fetchRadarLatest(product);
  if (!latest.ok) {
    return toToolResult({
      ok: false,
      url: `${RADAR_BASE}/findLastProductByType`,
      status: 0,
      data: null,
      error: latest.error ?? `Prodotto ${product} non disponibile`,
      elapsedMs: Date.now() - start,
    });
  }
  let downloadData: unknown = null;
  if (download && latest.time != null) {
    const dl = await fetchRadarDownload(product, latest.time);
    if (dl.ok) {
      const d = dl.data as { url?: string; key?: string; expiresSeconds?: number } | null;
      downloadData = {
        url: d?.url ?? null,
        key: d?.key ?? null,
        expiresSeconds: d?.expiresSeconds ?? 300,
        formato: "GeoTIFF",
        avviso: "URL pre-signed S3: valida circa 5 minuti dalla richiesta. Scaricare subito.",
      };
    } else {
      downloadData = { error: dl.error ?? "download fallito" };
    }
  }
  return toToolResult({
    ok: true,
    url: `${RADAR_BASE}/findLastProductByType?type=${product}`,
    status: 200,
    data: {
      fonte: "Radar-DPC, Dipartimento Protezione Civile (CC-BY-SA)",
      product,
      time: latest.time,
      timeIso: latest.timeIso,
      period: latest.period,
      ageMinutes: latest.ageMinutes,
      stale: latest.ageMinutes != null && latest.ageMinutes > 30,
      download: downloadData,
      portale: "https://radar.protezionecivile.it",
    },
    elapsedMs: Date.now() - start,
  });
}

export function registerDpc(server: McpServer) {
  server.registerTool(
    "pc_allerte",
    {
      title: "Protezione Civile Allerte (bollettino di criticità)",
      description:
        "Livelli di allerta DPC per zona di allerta dal bollettino di criticità nazionale ufficiale (repo GitHub pcm-dpc, aggiornato ogni giorno ~14:30 + aggiornamenti). Filtra per comune (match esatto sulle 7904 anagrafiche) o regione. Restituisce livelli 0-3 per rischio idraulico/temporali/idrogeologico, oggi e domani. Sostituisce pc_allerte_wms (endpoint api.protezionecivile.gov.it defunto).",
      inputSchema: {
        comune: z
          .string()
          .optional()
          .describe(
            "Nome del comune esatto (es. 'Rovigo', 'Reggio Calabria'). Match sulla lista ufficiale dei comuni della zona di allerta.",
          ),
        regione: z.string().optional().describe("Filtra per regione (es. 'Veneto'). Ignorato se comune trovato."),
        day: z.enum(["today", "tomorrow", "both"]).default("both").describe("Giorno di validità del bollettino"),
      },
      outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handlePcAllerte,
  );

  server.registerTool(
    "dpc_radar",
    {
      title: "Radar-DPC prodotti (nowcasting nazionale)",
      description:
        "Ultimo prodotto disponibile dalla piattaforma Radar-DPC (REST API ufficiale, aggiornamento 5-60 min a seconda del prodotto). Con download=true restituisce anche la pre-signed URL S3 del GeoTIFF (scade in ~300s: scaricarla subito). Prodotti: VMI (riflettività max, 5min), SRI (pioggia al suolo mm/h, 5min), SRT1 (cumulata 1h), CUM3/6/12/24 (cumulate pluviometriche), IR_108 (nuvolosità sat), TEMP (mappa temperature oraria), VIL/ETM/POH (grandine), CAPPI_1..10, SITES (stato radar). Sostituisce dpc_radar_vmi (parsing risposta errato: il timestamp è in lastProducts[0].time).",
      inputSchema: {
        product: z.enum(DPC_RADAR_PRODUCTS).default("VMI").describe("Tipo di prodotto radar/sat/suolo"),
        download: z
          .boolean()
          .default(false)
          .describe("Se true, richiede anche la URL di download del GeoTIFF (pre-signed, ~300s di validità)"),
      },
      outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    handleDpcRadar,
  );
}
