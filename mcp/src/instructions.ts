import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** Istruzioni inviate al client MCP alla connessione (campo `instructions` di initialize). */
export const SERVER_INSTRUCTIONS = `Meteo Italia: previsioni multi-modello e osservazioni per località italiane.

Flusso:
1. Per qualsiasi richiesta meteo su una località italiana chiama prima \`meteo_brief\` (geocoding incluso). Non servono altri tool per un quadro generale.
2. Approfondisci con i tool singoli solo se il brief segnala divergenze/anomalie o se la domanda lo richiede: ensemble (open_meteo_ensemble), radar (dpc_radar), fulmini (dmi_lightning), idro (floods_it_monitoring, open_meteo_flood), mare (open_meteo_marine), aria/pollini (open_meteo_air_quality, meteo_pollen), satellite (eumetsat_satellite_info).
3. Per contesti specifici (montagna, agricoltura, cantiere, nautica, salute, energia) usa dopo il brief meteo_bioclimatic_indices, meteo_local_phenomena e meteo_reference_guidelines.
4. Non stimare a memoria ciò che un tool può fornire. Se una fonte è assente o in errore, dichiaralo: non riempire il vuoto con numeri inventati.
5. Riporta sempre le divergenze tra fonti e il livello di confidenza del brief. Imposta timezone Europe/Rome. Per rifugi, malghe o punti in quota passa \`elevation\` (metri) a meteo_brief: le temperature vengono riportate a quella quota.

Per un report strutturato usa il prompt \`meteo_report\`.`;

const REPORT_COMMON = `Usa i dati reali di meteo_brief. Ogni sezione riporta il livello di confidenza del brief (alta/media/bassa) e le fonti usate; se una fonte non è disponibile scrivilo, senza stimare.
Evidenzia le divergenze tra modelli e fonti e spiega il meccanismo fisico più probabile. Chiudi con una raccomandazione operativa adatta alla domanda dell'utente.`;

const REPORT_LITE = `Rispondi in modo sintetico, in questo ordine:
- Sintesi (cielo, precipitazioni, vento)
- Temperatura min/max (percepita se rilevante)
- Allerta Protezione Civile (colore e tipologia)
- Precipitazioni: probabilità e accumulo
- Vento: velocità, raffiche, direzione`;

const REPORT_PRO = `Struttura il report in sezioni, saltando quelle senza dati: nowcasting radar, allerte, osservazioni ARPA e METAR, confronto con la climatologia, temperature e sensazione termica, precipitazioni e convezione, vento e fenomeni locali, mare, aria e pollini, idrologia, incertezza ensemble, sintesi delle anomalie, raccomandazione operativa.`;

export function registerPrompts(server: McpServer) {
  server.registerPrompt(
    "meteo_report",
    {
      title: "Report meteo strutturato",
      description: "Genera un report meteo (sintetico o completo) per una località italiana a partire da meteo_brief.",
      argsSchema: {
        luogo: z.string().describe("Località italiana (es. 'Rovigo')"),
        modo: z.enum(["lite", "pro"]).default("lite").describe("lite = sintesi rapida, pro = analisi dettagliata"),
        domanda: z
          .string()
          .optional()
          .describe("Domanda o contesto specifico dell'utente (es. 'getto di calcestruzzo')"),
      },
    },
    ({ luogo, modo, domanda }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `Meteo per ${luogo}${domanda ? ` — ${domanda}` : ""}.\nChiama meteo_brief per "${luogo}" e scrivi il report in modalità ${modo}.\n\n${REPORT_COMMON}\n\n${modo === "pro" ? REPORT_PRO : REPORT_LITE}`,
          },
        },
      ],
    }),
  );
}
