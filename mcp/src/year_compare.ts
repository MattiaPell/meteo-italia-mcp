import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { apiGet, toToolResult, latLon } from "./http.js";
import { round1 } from "./models.js";

// --- 8. YEAR COMPARISON TOOL ------------------------------------------------
export function registerYearCompare(server: McpServer) {
  server.registerTool(
    "meteo_year_compare",
    {
      title: "Year-over-Year Weather Comparison",
      description:
        "Compare current weather forecast with the same period last year (ERA5 reanalysis). Shows anomalies in temperature and precipitation to identify trends (warmer/cooler, wetter/drier).",
      inputSchema: {
        ...latLon,
        days: z.coerce.number().int().min(3).max(14).default(7).describe("Number of days to compare (3-14)"),
      },
      outputSchema: { ok: z.boolean(), url: z.string(), status: z.number(), data: z.unknown(), elapsedMs: z.number() },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ latitude, longitude, days }) => {
      const start = Date.now();

      const { start_date, end_date } = getLastYearDates(days);

      const [currentRes, lastYearRes] = await Promise.all([
        apiGet("https://api.open-meteo.com/v1/forecast", {
          latitude,
          longitude,
          daily: ["temperature_2m_max", "temperature_2m_min", "precipitation_sum"],
          past_days: days,
          forecast_days: 0,
          timezone: "Europe/Rome",
        }),
        apiGet("https://archive-api.open-meteo.com/v1/archive", {
          latitude,
          longitude,
          daily: ["temperature_2m_max", "temperature_2m_min", "precipitation_sum"],
          start_date,
          end_date,
          timezone: "Europe/Rome",
        })
      ]);

      if (!currentRes.ok || !lastYearRes.ok) {
        return toToolResult({
          ok: false,
          url: "mcp://year_compare",
          status: 0,
          data: null,
          error: `Dati non disponibili: current=${currentRes.ok}, lastYear=${lastYearRes.ok}`,
          elapsedMs: Date.now() - start,
        });
      }

      const { daily, diffs, cPrecip, lPrecip, cDates, lDates } = calculateDifferences(
        currentRes.data,
        lastYearRes.data,
      );

      const summary = computeSummary(diffs, cPrecip, lPrecip, daily.length);
      const trend = evaluateTrend(summary);

      return toToolResult({
        ok: true,
        url: "mcp://year_compare",
        status: 200,
        data: {
          location: { latitude, longitude },
          currentPeriod: { from: cDates[0], to: cDates[cDates.length - 1] },
          lastYearPeriod: { from: lDates[0], to: lDates[lDates.length - 1] },
          summary,
          trend,
          daily,
        },
        elapsedMs: Date.now() - start,
      });
    },
  );
}

function getLastYearDates(days: number) {
  const now = new Date();
  const currentStart = new Date(now);
  currentStart.setDate(now.getDate() - days);
  const lastYearStart = new Date(currentStart);
  lastYearStart.setFullYear(lastYearStart.getFullYear() - 1);
  const lastYearEnd = new Date(now);
  lastYearEnd.setFullYear(lastYearEnd.getFullYear() - 1);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  return {
    start_date: fmt(lastYearStart),
    end_date: fmt(lastYearEnd),
  };
}

function calculateDifferences(cData: any, lData: any) {
  const cDates: string[] = cData?.daily?.time ?? [];
  const lDates: string[] = lData?.daily?.time ?? [];
  const cTmax: number[] = cData?.daily?.temperature_2m_max ?? [];
  const cTmin: number[] = cData?.daily?.temperature_2m_min ?? [];
  const cPrecip: number[] = cData?.daily?.precipitation_sum ?? [];
  const lTmax: number[] = lData?.daily?.temperature_2m_max ?? [];
  const lTmin: number[] = lData?.daily?.temperature_2m_min ?? [];
  const lPrecip: number[] = lData?.daily?.precipitation_sum ?? [];

  const daily: any[] = [];
  const diffs = { tmax: [] as number[], tmin: [] as number[], precip: [] as number[] };

  for (let i = 0; i < Math.min(cDates.length, lDates.length); i++) {
    const cDate = cDates[i];
    const lDate = lDates[i];
    const cDay = parseInt(cDate.slice(8, 10));
    const lDay = parseInt(lDate.slice(8, 10));
    if (cDay !== lDay) continue;

    const dTmax = cTmax[i] != null && lTmax[i] != null ? round1(cTmax[i] - lTmax[i]) : null;
    const dTmin = cTmin[i] != null && lTmin[i] != null ? round1(cTmin[i] - lTmin[i]) : null;
    const dPrecip = cPrecip[i] != null && lPrecip[i] != null ? round1(cPrecip[i] - lPrecip[i]) : null;

    if (dTmax != null) diffs.tmax.push(dTmax);
    if (dTmin != null) diffs.tmin.push(dTmin);
    if (dPrecip != null) diffs.precip.push(dPrecip);

    daily.push({
      date: cDate,
      current: { tmax: cTmax[i], tmin: cTmin[i], precip: cPrecip[i] },
      lastYear: { tmax: lTmax[i], tmin: lTmin[i], precip: lPrecip[i] },
      delta: { tmax: dTmax, tmin: dTmin, precip: dPrecip },
    });
  }

  return { daily, diffs, cPrecip, lPrecip, cDates, lDates };
}

function computeSummary(diffs: any, cPrecip: number[], lPrecip: number[], daysAnalyzed: number) {
  const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  return {
    avgDeltaTmax: avg(diffs.tmax),
    avgDeltaTmin: avg(diffs.tmin),
    avgDeltaPrecip: avg(diffs.precip),
    totalPrecipCurrent: round1(cPrecip.reduce((a, b) => a + (b ?? 0), 0)),
    totalPrecipLastYear: round1(lPrecip.reduce((a, b) => a + (b ?? 0), 0)),
    daysAnalyzed,
  };
}

function evaluateTrend(summary: any) {
  return {
    temperature:
      summary.avgDeltaTmax != null
        ? summary.avgDeltaTmax > 1
          ? "Più caldo dell'anno scorso"
          : summary.avgDeltaTmax < -1
            ? "Più freddo dell'anno scorso"
            : "Simile all'anno scorso"
        : "Dati insufficienti",
    precipitation:
      summary.totalPrecipCurrent != null && summary.totalPrecipLastYear != null
        ? summary.totalPrecipCurrent > summary.totalPrecipLastYear * 1.3
          ? "Più piovoso dell'anno scorso"
          : summary.totalPrecipCurrent < summary.totalPrecipLastYear * 0.7
            ? "Più secco dell'anno scorso"
            : "Simile all'anno scorso"
        : "Dati insufficienti",
  };
}
