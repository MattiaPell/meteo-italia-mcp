import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toToolResult, ApiResult } from "./http.js";

// --- 5. EVENT RELIABILITY TOOL ----------------------------------------------
export function registerEventReliability(server: McpServer) {
  server.registerTool(
    "meteo_event_reliability",
    {
      title: "Forecast Reliability Matrix",
      description:
        "Affidabilità INDICATIVA delle previsioni per tipo di evento (convezione, pioggia frontale, nebbia, vento, ondate di calore) e orizzonte temporale. Sono valori di esperienza, non calibrati su verifiche misurate: usali per ordinare la fiducia relativa tra eventi, non come probabilità. Per probabilità misurate sul caso specifico usa ensemble.probabilita di meteo_brief.",
      inputSchema: {},
      outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const start = Date.now();
      const matrix = {
        frontal_rain_snow: {
          "0-24h": "Alta (90%)",
          "1-3d": "Buona (80%)",
          "4-7d": "Media (60%)",
          ">7d": "Bassa (40%)",
        },
        convective_storms: {
          "0-24h": "Media (65% - nowcasting required)",
          "1-3d": "Bassa (40%)",
          "4-7d": "Molto bassa (20%)",
          ">7d": "Nulla (0%)",
        },
        heatwave_cold_spell: {
          "0-24h": "Alta (95%)",
          "1-3d": "Alta (90%)",
          "4-7d": "Media (70%)",
          ">7d": "Bassa (50%)",
        },
        orographic_winds: { "0-24h": "Alta (85%)", "1-3d": "Buona (75%)", "4-7d": "Media (50%)", ">7d": "Bassa (30%)" },
        fog: { "0-24h": "Media (70%)", "1-3d": "Bassa (45%)", "4-7d": "Molto bassa (25%)", ">7d": "Nulla (0%)" },
        foehn_winds: { "0-24h": "Alta (90%)", "1-3d": "Buona (80%)", "4-7d": "Bassa (40%)", ">7d": "Nulla (0%)" },
      };
      const res: ApiResult = {
        ok: true,
        url: "mcp://event_reliability",
        status: 200,
        data: {
          indicativo: true,
          fonte:
            "Valori di esperienza (letteratura sintetica e pratica operativa), non derivati da una verifica statistica su dati del progetto.",
          reliabilityMatrix: matrix,
          guideline:
            "Use this matrix to assign confidence levels to forecast discussions. Severe convective storms require nowcasting (Step I/L) due to low predictability beyond 24h.",
        },
        elapsedMs: Date.now() - start,
      };
      return toToolResult(res);
    },
  );
}
