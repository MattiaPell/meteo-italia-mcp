# Meteo Italia MCP ⛅

Server **MCP** per l'**analisi meteo multi-modello sull'Italia**: confronta più modelli numerici, osservazioni ARPA, METAR, allerte della Protezione Civile e radar, e restituisce un quadro con consensus pesato, divergenze tra fonti e livello di confidenza.

Si collega a qualsiasi client MCP (Claude Desktop, Claude Code, OpenCode, agenti custom): le istruzioni d'uso arrivano dal server stesso (campo `instructions` e prompt `meteo_report`), non servono file da installare nell'agente.

## Come funziona

1. Il client chiede il meteo di una località italiana.
2. L'agente chiama **`meteo_brief`**: geocoding, previsione multi-modello (consensus pesato per macroarea; la temperatura è calibrata sull'errore recente dei modelli: contro i METAR della stazione entro 50 km se disponibili, altrimenti contro ERA5; vedi `nwp.calibrazione`), allerte, radar, METAR, ARPA ed ensemble in parallelo. L'output include le probabilità giornaliere dall'ensemble ECMWF (`ensemble.probabilita`: pioggia ≥1/≥10 mm, gelo, caldo ≥35 °C, raffica ≥60 km/h), `divergenze` e `confidenza` (`alta`/`media`/`bassa` con i motivi).
3. Solo se serve (anomalie, domanda specifica) approfondisce con i tool singoli: ensemble, fulmini, idro, mare, aria e pollini, indici bioclimatici, fenomeni locali.
4. Il prompt MCP **`meteo_report`** (modalità `lite` o `pro`) guida la stesura del report.

Dati e calcoli (pesi, bias, indici, soglie) stanno nel server: l'agente non deve implementare formule né caricare tabelle in contesto. Se una fonte è giù, il brief la segnala come non disponibile e prosegue con le altre.

## Configurazione

- **METAR/TAF (CheckWX)**, opzionale: imposta `CHECKWX_API_KEY` come variabile d'ambiente (chiave gratuita su [checkwxapi.com](https://www.checkwxapi.com/)). Senza chiave si usa il fallback AviationWeather.

Le altre API (Open-Meteo, DPC Radar, DMI Lightning, floods.it, EUMETSAT) sono ad accesso libero.

## Installazione

### Installazione rapida

```bash
cd mcp && npm install && npm run build
```

### Esecuzione

```bash
# Solo MCP stdio (per client MCP)
node mcp/dist/index.js

# MCP stdio + debug web su http://localhost:3000
METEO_MCP_DEBUG_PORT=3000 node mcp/dist/index.js
```

### Configurazione client

**OpenCode** (`.opencode.json` o `opencode.jsonc`):
```json
{
  "mcpServers": {
    "meteo-italia": {
      "command": "node",
      "args": ["mcp/dist/index.js"],
      "env": { "CHECKWX_API_KEY": "${CHECKWX_API_KEY}" }
    }
  }
}
```

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "meteo-italia": {
      "command": "node",
      "args": ["/percorso/assoluto/meteo-italia-mcp/mcp/dist/index.js"],
      "env": { "CHECKWX_API_KEY": "tua_chiave" }
    }
  }
}
```

> `CHECKWX_API_KEY` è opzionale (per METAR/TAF). Ottienila gratis su [checkwxapi.com](https://www.checkwxapi.com/).

### Tool MCP

| Tool | Servizio | Tipo |
|---|---|---|
| `meteo_brief` | **Aggregatore multi-fonte** (NWP pesato per macroarea + PC + radar + METAR + ARPA + ensemble). Parametro opzionale `elevation` (m) per riportare le temperature alla quota di rifugi/malghe | API |
| `open_meteo_geocode` | Open-Meteo Geocoding | API |
| `open_meteo_forecast` | Open-Meteo Forecast (raw) | API |
| `open_meteo_forecast_summary` | Open-Meteo Forecast (compact, ~85% meno contesto) | API |
| `open_meteo_archive` | Open-Meteo Archive (ERA5) | API |
| `open_meteo_marine` | Open-Meteo Marine | API |
| `open_meteo_air_quality` | Open-Meteo Air-Quality (CAMS) | API |
| `open_meteo_ensemble` | Open-Meteo Ensemble | API |
| `open_meteo_flood` | Open-Meteo Flood (GloFAS v4, portata fiumi a 5km) | API |
| `open_meteo_seasonal` | Open-Meteo Seasonal (ECMWF SEAS5, outlook fino a 7 mesi) | API |
| `pc_allerte` | Protezione Civile — bollettino criticità (GitHub pcm-dpc), filtro comune/regione | API |
| `dpc_radar` | Radar-DPC REST (22 prodotti, GeoTIFF pre-signed) | API |
| `checkwx_metar_taf` | CheckWX METAR/TAF (richiede key) | API |
| `aviationweather_metar` | AviationWeather METAR (fallback, no auth) | API |
| `dmi_lightning` | DMI Lightning (fulmini) | API |
| `floods_it_monitoring` | floods.it (idro Trentino-Alto Adige) | API |
| `arpav_bollettino` | ARPAV previsione 15 zone Veneto | API |
| `arpav_idro` | ARPAV livelli idrometrici 103 stazioni (Veneto) | API |
| `meteotrentino_osservazioni` | Meteotrentino osservazioni stazioni (P.A. Trento) | API |
| `arpae_bollettino` | ARPAE bollettino meteo Emilia-Romagna (fino 4gg) | API |
| `arpafvg_previsioni` | ARPA FVG/OSMER previsioni regionali | API |
| `arpafvg_stazione` | ARPA FVG/OSMER dati stazione (T, vento, pioggia, neve) | API |
| `arpa_marche_stazioni` | ARPA Marche/AMAP elenco stazioni agrometeo | API |
| `arpa_marche_stazione` | ARPA Marche/AMAP dettaglio stazione con sensori | API |
| `arpa_marche_grandezze` | ARPA Marche/AMAP grandezze misurate | API |
| `arpa_lombardia_stazioni` | ARPA Lombardia elenco stazioni idro-nivo-meteo | API |
| `arpa_lombardia_osservazioni` | ARPA Lombardia osservazioni recenti | API |
| `arpa_piemonte_stazioni` | ARPA Piemonte elenco stazioni (336 stazioni) | API |
| `eumetsat_satellite_info` | EUMETSAT (metadata satellite) | API |
| `meteo_climatology` | Climatologia ERA5 (110 città, anomalie/σ) | Locale |
| `meteo_bioclimatic_indices` | Heat Index, Wind Chill, GDD, quota neve, incendi, energia FV/Eolico | Locale |
| `meteo_local_phenomena` | Riconoscimento Bora, Foehn, Scirocco, Libeccio, Tramontana, Garbino, Breva/Tivano, Nebbia, Gelicidio | Locale |
| `meteo_model_tuning` | Pesi zone, bias modelli, correzione UHI | Locale |
| `meteo_event_reliability` | Matrice affidabilità forecast | Locale |
| `meteo_reference_guidelines` | Tabelle statiche (pollen, uv, construction, tourism, ecc.) | Locale |
| `meteo_verification` | Verifica storica: forecast vs ERA5 (MAE, bias, RMSE) | Locale |
| `meteo_year_compare` | Confronto annuale: meteo attuale vs anno scorso (ERA5) | Locale |
| `meteo_pollen` | Previsione pollini Italia (calendario + meteo) | Locale |

> **Breaking changes 2026-07**: `pc_allerte_wms` → `pc_allerte` (host bollettini defunto,
> nuova fonte GitHub pcm-dpc), `dpc_radar_vmi` → `dpc_radar` (parsing risposta REST
> aggiornata alla nuova piattaforma), `arpav_idro` nuova firma.
> **Nuovi 2026-07**: `meteo_brief`, `arpae_bollettino`, `arpafvg_previsioni`,
> `arpafvg_stazione`, `arpa_marche_*`, `arpa_lombardia_*`, `arpa_piemonte_stazioni`,
> `open_meteo_flood`, `open_meteo_seasonal`, `meteo_verification`.

### Base URL utilizzati dal progetto

Tutti gli endpoint contattati dal server MCP (elenco completo e verificato; l'host originale `api.protezionecivile.gov.it` è stato rimosso perché il DNS è morto).

**Open-Meteo (NWP, clima, marine, qualità aria, ensemble, alluvioni, stagionale)**
- `https://geocoding-api.open-meteo.com/v1/search` — geocoding città italiane
- `https://api.open-meteo.com/v1/forecast` — forecast multi-modello (meteo_brief)
- `https://archive-api.open-meteo.com/v1/archive` — ERA5 historical / climatologia
- `https://marine-api.open-meteo.com/v1/marine` — mare e SST
- `https://air-quality-api.open-meteo.com/v1/air-quality` — CAMS europee
- `https://ensemble-api.open-meteo.com/v1/ensemble` — spread probabilistico (meteo_brief)
- `https://flood-api.open-meteo.com/v1/flood` — GloFAS v4 (portata fiumi a 5km, 50 membri ensemble)
- `https://seasonal-api.open-meteo.com/v1/seasonal` — ECMWF SEAS5 (outlook stagionale 6-ore, fino a 7 mesi)

**Protezione Civile — bollettino di criticità (allerte)**
- `https://api.github.com/repos/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica` — discovery ultimo stamp via git tree API (repo ufficiale del DPC)
- `https://raw.githubusercontent.com/pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica/master/files/...` — metadati JSON + geojson zone (fonte dati strutturata)
- Portale umano: `https://mappe.protezionecivile.gov.it/it/mappe-rischi/bollettino-di-criticita/` — visualizzazione ufficiale
- App mappa: `https://servizio-mappe.protezionecivile.it` — dashboard MapLite usata dal portale
- Documentazione bollettino: repository GitHub `pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica`

**Radar-DPC (nowcasting) — REST API ufficiale (https://dpc-radar.readthedocs.io/it/latest/api.html)**
- `https://radar-api.protezionecivile.it/findLastProductByType` — ultimo timestamp per prodotto (VMI, SRI, SRT1, IR_108, TEMP, CUM3/6/12/24, CAPPI_1..10, VIL, ETM, POH, SITES)
- `https://radar-api.protezionecivile.it/downloadProduct` — POST → pre-signed URL S3 del GeoTIFF (valida ~300s)
- `origin` header / query param obbligatorio: `https://radar.protezionecivile.it` (pure portale visuale)
- WebSocket push (NON integrato nel MCP stdio, documentato): `wss://radar-wss.protezionecivile.it` — notifica nuovi prodotti; client ufficiali java/python su `https://github.com/pcm-dpc/DPC-Radar-data-downloader` (branch `radarv2`)
- Servizi WMS/WMTS (`https://radar-geowebcache.protezionecivile.it/service/`) — NON usati: nel nostro caso non utili (PNG tile 256×256 a layer fissato, no arricchimento informativo rispetto al GeoTIFF+REST)

**METAR/TAF aeronautici**
- `https://aviationweather.gov/api/data/metar` — METAR grezzo/JSON senza chiave (fallback principale)
- `https://api.checkwx.com/v2/{metar|taf}/{ICAO}/decoded` — METAR/TAF decodificati (richiede `CHECKWX_API_KEY`)

**Fulmini (lightning)**
- `https://opendataapi.dmi.dk/v2/lightningdata/collections/observation/items` — DMI Open Data OGC API-Features (copertura italiana incerta)

**Idrologia**
- `https://www.floods.it/api/v1/monitoring/` — Trentino-Alto Adige realtime (TIER A)

**ARPA regionali (osservazioni real-time)**
- Veneto (ARPAV):
  - `https://api.arpa.veneto.it/REST/v1/bollettini_meteo_simboli_en` — previsione 15 zone (Centro Meteorologico)
  - `https://www.arpa.veneto.it/api/risorse/data-meteo/xml/Ultime48ore.xml` — livelli idrometrici 103 stazioni (ultime 48h)
  - Portale: `https://www.arpa.veneto.it` · mappa stazioni: `https://meteo.arpa.veneto.it`
- Trentino (Meteotrentino / P.A. Trento, open data):
  - `https://dati.meteotrentino.it/service.asmx/listaStazioni` — anagrafica stazioni (XML)
  - `https://dati.meteotrentino.it/service.asmx/ultimiDatiStazione?codice={COD}` — dati recenti stazione
  - Portale: `https://www.meteotrentino.it`
- Emilia-Romagna (ARPAE, open data CC BY):
  - `https://apps.arpae.it/REST/meteo_bollettini/` — API Eve REST: bollettino meteo ultimo + storico
  - `https://dati.arpae.it/it/dataset/bollettino-testuale-previsioni-meteo` — catalogo open data
  - Portale: `https://www.arpae.it`
- Friuli-Venezia Giulia (ARPA FVG / OSMER):
  - `http://dev.meteo.fvg.it/xml/previsioni/PW{YYYYMMDD}.xml` — previsioni XML bilingue (it/en/de/sl/fur)
  - `http://dev.meteo.fvg.it/xml/stazioni/{CODICE}.xml` — osservazioni stazione real-time
  - WFS anagrafica: `https://serviziogc.regione.fvg.it/WMS_TERRITORIO/wfs` (309 stazioni, EPSG:6708)
  - Portale: `https://dev.meteo.fvg.it`
- Marche (AMAP Agrometeo, CC BY):
  - `https://apimeteo.regione.marche.it/Stazioni` — anagrafica stazioni (JSON)
  - `https://apimeteo.regione.marche.it/Stazione/{COD}` — dettaglio stazione con sensori
  - `https://apimeteo.regione.marche.it/Grandezze` — grandezze misurate (unità, codici)
  - Portale: `https://meteo.regione.marche.it/OpenData`
- Lombardia (ARPA Lombardia, CC BY 4.0):
  - `https://www.dati.lombardia.it/resource/nf78-nj6b.json` — stazioni idro-nivo-meteo (Socrata API)
  - `https://www.dati.lombardia.it/resource/647i-nhxk.json` — osservazioni sensori (Socrata API)
  - Portale: `https://www.arpalombardia.it`
- Piemonte (ARPA Piemonte, CC BY):
  - `https://utility.arpa.piemonte.it/meteoidro/stazione_meteorologica/` — 336 stazioni (Django REST)
  - `https://utility.arpa.piemonte.it/meteoidro/dati_giornalieri_meteo/` — dati giornalieri
  - Portale: `https://www.arpa.piemonte.it`
- Altre regioni: nessuna API pubblica verificata. Fallback = METAR + radar DPC.

**Satellite (metadata-only)**
- `https://api.eumetsat.int` — richiede CONSUMER_KEY/CONSUMER_SECRET; dati binari NetCDF/HRIT (fetch fuori MCP)
- `https://eoportal.eumetsat.int` — portale
- `https://eumetview.eumetsat.int` — immagini pre-renderizzate fallback

**Rate limiting**
- GitHub anonimo: 60 req/h — mitigato da cache 30min su `resolveLatestStamp`()
- CheckWX: 3000 req/giorno — fallback automatico su aviationweather.gov
- Open-Meteo: fair use, no hard limit

**Endpoint non più utilizzati (rimossi)**
- `https://api.protezionecivile.gov.it/bollettini/allerte/ultimo` — **DNS morto**, sostituito dalla catena GitHub pcm-dpc
- `https://mappe.protezionecivile.gov.it/geowebcache/service/wms` (vecchio endpoint radar)
- `https://api.arpa.veneto.it/rest/v1/meteo/stazioni/{id}/dati` (lowercase) — **404**, sostituito da `REST/v1/bollettini_meteo_simboli_en` + XML `Ultime48ore.xml`

Ogni tool ritorna `{ ok, url, status, data, elapsedMs }`.

**Prompt MCP**: `meteo_report` (argomenti `luogo`, `modo` = `lite`|`pro`, `domanda` opzionale) genera il report a partire da `meteo_brief`.

Per dettagli su build, test, MCP Inspector e debug API → [`mcp/README.md`](mcp/README.md).

## Funzionalità

| Funzionalità | Descrizione |
|---|---|
| **Multi-modello** | Confronta simultaneamente fino a 10 modelli su Open-Meteo API |
| **Geocoding** | Ricerca città italiane con discriminazione omonimi via `admin1` (regione) |
| **Fenomeni locali** | Riconoscimento automatico di foehn, bora, scirocco, tramontana, libeccio, grandine padana, neve appenninica, temporali adriatici |
| **Allerte** | Integrazione allerte da fonti pubbliche per regione (solo informativo) |
| **Qualità aria** | Dati CAMS via Open-Meteo AQ API |
| **Rischio idraulico** | Portata fluviale simulata GloFAS v4 a 5km (fino a 12 mesi, 50 membri ensemble) |
| **Outlook stagionale** | Tendenze climatiche ECMWF SEAS5 fino a 7 mesi |
| **Matrice affidabilità** | Affidabilità forecast per tipo di evento × orizzonte temporale |
| **Bias noti** | Calibrazione per macroarea italiana con bias documentati per modello e stagione |
| **METAR/TAF** | Validazione forecast con dati aeroportuali osservati (CheckWX API) |
| **Lightning Detection** | Nowcasting temporali con fulmini in tempo reale (DMI API) |
| **Dati Idrologici** | Monitoraggio fiumi e rischio alluvioni (floods.it + ARPAV + GloFAS) |
| **Immagini Satellite** | Validazione visiva nowcasting con Meteosat (EUMETSAT) |

## Modelli Supportati

| Modello | Ente | Copertura | Risoluzione |
|---|---|---|---|
| ECMWF IFS | Centro Europeo | Globale | 9 km |
| ICON | DWD (Germania) | Globale + EU | 13 km / 7 km |
| GFS | NOAA (USA) | Globale | 13 km |
| GEFS | NOAA (USA) | Globale ensemble | 25 km |
| Arpège | Météo France | Globale + EU | 10 km / 5 km |
| AROME | Météo France | EU + Francia | 2.5 km |
| ICON-EU | DWD (Germania) | Europa | 7 km |
| MetOffice | UK Met Office | Globale | 10 km |
| GEM | Canada | Globale | 15 km |
| JMA | Giappone | Globale | 20 km |

## Licenza

MIT
