import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiGet, toToolResult } from "../http.js";
import type { ArpaBriefResult } from "./types.js";

// ---------------------------------------------------------------------------
// ARPAE Emilia-Romagna — bollettino meteo regionale
// https://apps.arpae.it/REST/meteo_bollettini/ (Eve REST framework)
// https://dati.arpae.it/it/dataset/bollettino-testuale-previsioni-meteo
// ---------------------------------------------------------------------------

const BOLLETTINO_BASE = "https://apps.arpae.it/REST/meteo_bollettini";

/** Province ER con codice usato nell'API. */
const PROVINCE = ["BO", "FE", "FC", "MO", "PC", "PR", "RA", "RE", "RN"] as const;
type Provincia = (typeof PROVINCE)[number];

/** Giorni disponibili nel bollettino. */
const GIORNI = ["oggi", "domani", "dopodomani", "quartogiorno"] as const;

export interface ArpaeGiorno {
  validita?: string;
  emissione?: string;
  regionale?: {
    cielo?: string | null;
    temperatura?: string | null;
    vento?: string | null;
    mare?: string | null;
  };
  dati_tabellari?: Record<
    string,
    {
      tmin?: number | null;
      tmax?: number | null;
      precipitazioni?: string | null;
    }
  >;
  provinciale?: Record<
    string,
    {
      testo?: string | null;
      tmin?: number | null;
      tmax?: number | null;
      precipitazioni?: string | null;
      vento?: string | null;
      vento_max?: string | null;
      temperatura?: string | null;
    }
  >;
}

interface ArpaeAreaRaw {
  tmin_previ?: number | null;
  tmax_previ?: number | null;
  precipitazioni?: string | null;
}

interface ArpaeProvinciaRaw {
  testo_previsione?: string | null;
  temperatura_minima?: number | null;
  temperatura_massima?: number | null;
  precipitazioni?: string | null;
  vento?: string | null;
  vento_massimo?: string | null;
  temperatura?: string | null;
}

/** Bollettino di un giorno come restituito dall'API Eve. */
interface ArpaeGiornoRaw {
  bollettino?: {
    validita?: string;
    emissione?: string;
    regionale?: {
      testo?: {
        cielo?: string | null;
        temperatura?: string | null;
        vento?: string | null;
        mare?: string | null;
      };
      dati_tabellari?: Partial<Record<"costa" | "pianura" | "rilievi", ArpaeAreaRaw>>;
    };
    provinciale?: Partial<Record<Provincia, ArpaeProvinciaRaw>>;
  };
}

/** Documento completo: una chiave per giorno (oggi, domani, ...). */
export type ArpaeRaw = Record<string, ArpaeGiornoRaw | undefined> & { _id?: string };

interface ArpaeListItem {
  _id?: string;
  emissione?: string;
}

/** Estrai il testo regionale o provinciale in formato compatto. */
export function formatGiorno(day: string, data: ArpaeRaw | null | undefined): ArpaeGiorno {
  const b = data?.[day]?.bollettino;
  if (!b) return {};

  const regionale = b.regionale?.testo;
  const tabellare = b.regionale?.dati_tabellari;
  const provinciale = b.provinciale;

  const out: ArpaeGiorno = {
    validita: b.validita,
    emissione: b.emissione,
  };

  if (regionale) {
    out.regionale = {
      cielo: regionale.cielo ?? null,
      temperatura: regionale.temperatura ?? null,
      vento: regionale.vento ?? null,
      mare: regionale.mare ?? null,
    };
  }

  if (tabellare) {
    const tbl: NonNullable<ArpaeGiorno["dati_tabellari"]> = {};
    for (const area of ["costa", "pianura", "rilievi"] as const) {
      const a = tabellare[area];
      if (a) {
        tbl[area] = {
          tmin: a.tmin_previ ?? null,
          tmax: a.tmax_previ ?? null,
          precipitazioni: a.precipitazioni ?? null,
        };
      }
    }
    out.dati_tabellari = tbl;
  }

  if (provinciale) {
    const prov: NonNullable<ArpaeGiorno["provinciale"]> = {};
    for (const p of PROVINCE) {
      const pp = provinciale[p];
      if (pp) {
        prov[p] = {
          testo: pp.testo_previsione ?? null,
          tmin: pp.temperatura_minima ?? null,
          tmax: pp.temperatura_massima ?? null,
          precipitazioni: pp.precipitazioni ?? null,
          vento: pp.vento ?? null,
          vento_max: pp.vento_massimo ?? null,
          temperatura: pp.temperatura ?? null,
        };
      }
    }
    out.provinciale = prov;
  }

  return out;
}

// --- Adapter per brief.ts (Emilia-Romagna) -----------------------------------
export async function runBriefArpa(_lat: number, _lon: number): Promise<ArpaBriefResult> {
  const list = await apiGet(`${BOLLETTINO_BASE}/?sort=-_id&max_results=1`, {});
  if (!list.ok) return { ok: false, agenzia: "ARPAE Emilia-Romagna", error: list.error };
  const items: ArpaeListItem[] = (list.data as { _items?: ArpaeListItem[] } | null)?._items ?? [];
  if (!items.length) return { ok: false, agenzia: "ARPAE Emilia-Romagna", error: "nessun bollettino" };
  const id = items[0]._id;
  const full = await apiGet(`${BOLLETTINO_BASE}/${id}`, {});
  if (!full.ok) return { ok: false, agenzia: "ARPAE Emilia-Romagna", error: full.error };
  const raw = full.data as ArpaeRaw;
  return {
    ok: true,
    agenzia: "ARPAE Emilia-Romagna (dati.arpae.it)",
    bollettino: {
      emissione: items[0]?.emissione ?? null,
      oggi: formatGiorno("oggi", raw),
      domani: formatGiorno("domani", raw),
    },
  };
}

export function registerArpae(server: McpServer) {
  server.registerTool(
    "arpae_bollettino",
    {
      title: "ARPAE Bollettino Meteo Emilia-Romagna",
      description:
        "Bollettino meteorologico regionale ARPAE Emilia-Romagna con previsioni fino a 4 giorni. Include testo regionale (cielo, temperatura, vento, mare), dati tabellari per fascia (costa, pianura, rilievi) e dettaglio provinciale (BO, FE, FC, MO, PC, PR, RA, RE, RN). Fonte: Arpae SIMC / dati.arpae.it.",
      inputSchema: {
        giorno: z
          .enum(GIORNI)
          .optional()
          .describe("Giorno: oggi, domani, dopodomani, quartogiorno. Omesso = tutti i giorni."),
        provincia: z
          .string()
          .optional()
          .describe("Sigla provincia (BO, FE, FC, MO, PC, PR, RA, RE, RN). Omesso = solo regionale."),
      },
      outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ giorno, provincia }) => {
      // Ottieni l'ultimo bollettino
      const list = await apiGet(`${BOLLETTINO_BASE}/?sort=-_id&max_results=1`, {});
      if (!list.ok) return toToolResult(list);

      const items: ArpaeListItem[] = (list.data as { _items?: ArpaeListItem[] } | null)?._items ?? [];
      if (!items.length) {
        return toToolResult({
          ok: false,
          url: list.url,
          status: 200,
          data: null,
          error: "Nessun bollettino disponibile",
          elapsedMs: list.elapsedMs,
        });
      }

      const id = items[0]._id;
      const full = await apiGet(`${BOLLETTINO_BASE}/${id}`, {});
      if (!full.ok) return toToolResult(full);

      const raw = full.data as ArpaeRaw;

      // Se richiesto provincia, filtra solo quella
      const provFilter = provincia?.toUpperCase();
      if (provFilter && !PROVINCE.includes(provFilter as Provincia)) {
        return toToolResult({
          ok: false,
          url: full.url,
          status: 200,
          data: null,
          error: `Provincia non valida: ${provFilter}. Valide: ${PROVINCE.join(", ")}`,
          elapsedMs: full.elapsedMs,
        });
      }

      const giorni = giorno ? [giorno] : GIORNI;
      const previsioni: Record<string, unknown> = {};

      for (const g of giorni) {
        const gd = formatGiorno(g, raw);
        if (provFilter && gd) {
          // Filtra solo provincia richiesta e regionale
          const gObj = gd as Record<string, unknown>;
          const prov = (gObj.provinciale as Record<string, unknown>)?.[provFilter];
          gObj.provinciale = provFilter ? { [provFilter]: prov } : {};
        }
        previsioni[g] = gd;
      }

      return toToolResult({
        ...full,
        data: {
          fonte: "Arpae Emilia-Romagna — SIMC (CC BY 4.0)",
          id_bollettino: id,
          emissione: raw.oggi?.bollettino?.emissione ?? null,
          previsioni,
          giorni_disponibili: giorni,
        },
      });
    },
  );
}
