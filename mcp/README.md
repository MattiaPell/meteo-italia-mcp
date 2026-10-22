# meteo-italia-mcp-server

MCP server (TypeScript) + pagina web di debug che wrappa tutte le API esterne
esposte dal server `meteo-italia`: Open-Meteo (forecast, geocoding, archive,
marine, air-quality, ensemble, flood/GloFAS, seasonal), reti ARPA regionali
(Veneto, Trentino, Emilia-Romagna, FVG, Marche, Lombardia, Piemonte),
Protezione Civile (allerte/radar), CheckWX METAR/TAF, AviationWeather,
DMI fulmini, floods.it, EUMETSAT. 35 tool totali (29 API + 6 locali).

## Build

```bash
npm install
npm run build      # compila in dist/ con tsc
```

Richiede Node >= 20 (fetch nativo). Testato in CI su Node 20 e 22.

## Esecuzione

**Come server MCP (stdio):** lo avvii così da un client MCP (OpenCode, Claude Desktop…):

```bash
node dist/index.js
```

**Con pagina di debug web:** imposta `METEO_MCP_DEBUG_PORT` (es. 3000). Senza variabile la pagina è disattivata.
Il processo apre anche un listener HTTP sulla porta indicata servendo la UI di debug.

```bash
METEO_MCP_DEBUG_PORT=3000 node dist/index.js
# apri http://localhost:3000
```

La pagina elenca tutti i servizi, permette di inserire i parametri e mostra
richiesta (URL), risposta JSON e tempo di risposta / errori. Utile per validare
i nomi dei modelli Open-Meteo e debuggare le chiamate prima di usarle in un client.

**Log:** una riga JSON per evento su stderr (stdout è riservato al protocollo MCP).
Livello con `METEO_MCP_LOG_LEVEL` = `debug` | `info` (default) | `warn` | `error` | `silent`.
A `debug` si vede ogni chiamata upstream riuscita; a `warn` retry ed errori upstream.

**CheckWX:** il tool `checkwx_metar_taf` richiede la variabile d'ambiente
`CHECKWX_API_KEY`. Senza key, il tool ritorna un errore esplicito e puoi usare
`aviationweather_metar` as fallback senza autenticazione.

## Tool esposti (35 totali: 29 API + 6 locali)

### Open-Meteo (9 tool)

| Tool | Descrizione | Tipo |
|---|---|---|
| `open_meteo_geocode` | Geocoding città italiane | Esterno |
| `open_meteo_forecast` | Forecast multi-modello (raw hourly/daily) | Esterno |
| `open_meteo_forecast_summary` | Forecast compact per-model daily summary (~90% meno contesto) | Esterno |
| `open_meteo_archive` | Archive ERA5 (climatologia) | Esterno |
| `open_meteo_marine` | Dati marini (onde, SST) | Esterno |
| `open_meteo_air_quality` | Qualità aria CAMS (PM2.5/PM10, O3, NO2, pollini) | Esterno |
| `open_meteo_ensemble` | Ensemble probabilistico (spread, membri) | Esterno |
| `open_meteo_flood` | Rischio idraulico GloFAS v4 (portata fiumi, 5km) | Esterno |
| `open_meteo_seasonal` | Outlook stagionale ECMWF SEAS5 (fino a 7 mesi) | Esterno |

### Fonti italiane — Protezione Civile, METAR, fulmini, satellite (7 tool)

| Tool | Descrizione | Tipo |
|---|---|---|
| `meteo_brief` | **Aggregatore multi-fonte**: NWP + allerte PC + radar + METAR + ARPA + ensemble in 1 chiamata. Entry point di default. | Esterno |
| `pc_allerte` | Bollettino criticità DPC (GitHub pcm-dpc), filtro comune/regione | Esterno |
| `dpc_radar` | Radar-DPC REST (22 prodotti: VMI, SRI, cumulate, IR108, TEMP, VIL/ETM/POH, CAPPI, SITES) | Esterno |
| `checkwx_metar_taf` | CheckWX METAR/TAF (richiede key) | Esterno |
| `aviationweather_metar` | AviationWeather METAR (fallback, no auth) | Esterno |
| `dmi_lightning` | DMI Lightning (fulmini, nowcasting temporali) | Esterno |
| `floods_it_monitoring` | floods.it idrologia Trentino-Alto Adige | Esterno |

### Reti ARPA regionali (13 tool)

| Tool | Regione | Descrizione | Tipo |
|---|---|---|---|
| `arpav_bollettino` | Veneto | Previsione Centro Meteorologico per 15 zone | Esterno |
| `arpav_idro` | Veneto | Livelli idrometrici 103 stazioni (XML 48h) | Esterno |
| `meteotrentino_osservazioni` | Trentino | Osservazioni stazioni P.A. Trento | Esterno |
| `arpae_bollettino` | Emilia-Romagna | Bollettino meteo fino 4gg (regionale + provinciale) | Esterno |
| `arpafvg_previsioni` | Friuli-Venezia Giulia | Previsioni OSMER (zone, simboli, probabilità) | Esterno |
| `arpafvg_stazione` | Friuli-Venezia Giulia | Dati osservati stazione (T, vento, pioggia, neve) | Esterno |
| `arpa_marche_stazioni` | Marche | Elenco stazioni AMAP Agrometeo | Esterno |
| `arpa_marche_stazione` | Marche | Dettaglio stazione con sensori | Esterno |
| `arpa_marche_grandezze` | Marche | Grandezze misurate (unità, codici) | Esterno |
| `arpa_lombardia_stazioni` | Lombardia | Elenco stazioni idro-nivo-meteo (Socrata) | Esterno |
| `arpa_lombardia_osservazioni` | Lombardia | Osservazioni recenti (T, pioggia, vento, umidità) | Esterno |
| `arpa_piemonte_stazioni` | Piemonte | Elenco stazioni meteo (336 stazioni, CC BY) | Esterno |
| `eumetsat_satellite_info` | — | EUMETSAT metadata satellite (collection, canali) | Esterno |

### Knowledge base locale (6 tool)

| Tool | Descrizione | Tipo |
|---|---|---|
| `meteo_climatology` | Climatologia ERA5 (110 città italiane, anomalie/sigma) | Locale |
| `meteo_bioclimatic_indices` | Heat Index, Wind Chill, GDD, soglie Vite/Api/Olivo, quota neve, rischio incendi | Locale |
| `meteo_local_phenomena` | Riconoscimento Bora, Foehn, Scirocco, Nebbia, Gelicidio | Locale |
| `meteo_model_tuning` | Pesi zone, bias modelli, correzione UHI | Locale |
| `meteo_event_reliability` | Matrice affidabilità forecast per orizzonte/tipo evento | Locale |
| `meteo_reference_guidelines` | Tabelle statiche (models, marine, air_quality, mountain, hydro, nowcasting, satellite, lightning, aviation, portals) | Locale |

> **Breaking changes 2026-07**: rimossi `pc_allerte_wms` e `dpc_radar_vmi` (endpoint
> defunti/parsing errato). Nuovi: `meteo_brief`, `arpae_bollettino`, `arpafvg_*`,
> `arpa_marche_*`, `arpa_lombardia_*`, `arpa_piemonte_*`, `open_meteo_flood`,
> `open_meteo_seasonal`.

Ogni tool ritorna `structuredContent` con `{ ok, url, status, data, elapsedMs }`.

## Test

```bash
# avvia con debug su 3000, poi:
curl -s -X POST http://localhost:3000/api/debug \
  -H 'Content-Type: application/json' \
  -d '{"service":"geocoding","params":{"name":"Roma"}}'
```

Oppure via MCP Inspector: `npx @modelcontextprotocol/inspector node dist/index.js`
