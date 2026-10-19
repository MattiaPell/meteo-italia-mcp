---
source: "MCP"
last_verified: "2026-07-28"
confidence: "high"
---

# MCP Meteorological Reference & Guidelines (Italia)

Questo è l'unico file di riferimento consolidato per il server MCP di **Meteo Italia Skill**. Contiene le mappature dei tool, le linee guida di fallback, le tabelle interpretative statiche e le specifiche per l'integrazione multi-fonte.

---

## 🛠️ Mappatura Rapida dei Tool MCP

| Ambito / Categoria | Tool MCP | Descrizione / Parametri Principali |
|---|---|---|
| **Aggregatore Globale** | `meteo_brief` | **Sempre obbligatorio come Step 0**. Esegue query parallela di NWP, allerte, radar, METAR e ARPA regionali in un colpo solo. |
| **Geocoding** | `open_meteo_geocode` | Risolve località italiane con `count=10` e filtro `country_code == 'IT'`. |
| **Forecast NWP** | `open_meteo_forecast`<br>`open_meteo_forecast_summary` | Previsioni numeriche. Il summary riduce il contesto dell'85%. Supporta 3 livelli di fetch progressivi. |
| **Climatologia** | `meteo_climatology` | Norme storiche ERA5 (1991-2020) per 110 città italiane per valutare anomalie termiche/precipitative. |
| **Indici Bioclimatici** | `meteo_bioclimatic_indices` | Calcola Heat Index, THI stalle, Wind Chill, GDD, bilancio idrico a 7gg, Quota Neve Nimbus, e Nimbus Fire Risk. |
| **Fenomeni Locali** | `meteo_local_phenomena` | Rilevamento algoritmico di Foehn, Bora, Scirocco, Maccaja, Gelicidio, Caligo/Lupa, e Acqua Alta. |
| **Calibrazione & Bias** | `meteo_model_tuning` | Fornisce i pesi di consensus per macroarea, bias sistematici dei modelli e correzioni per isole di calore (UHI). |
| **Affidabilità** | `meteo_event_reliability` | Matrice di affidabilità percentuale per tipologia di evento e orizzonte temporale. |
| **Linee Guida Statiche** | `meteo_reference_guidelines` | Fornisce tabelle e scale statiche (Beaufort, Douglas, AQI, AINEVA, ICAO, ecc.) divise per categorie. |
| **Previsione Pollini** | `meteo_pollen` | Stima del carico pollinico basata su fioritura stagionale, coordinate geografiche e condizioni meteo. |
| **Verifica Storica** | `meteo_verification` | Compara previsioni passate con ERA5 reanalysis calcolando MAE, bias sistematico e RMSE. |
| **Confronto Annuale** | `meteo_year_compare` | Analizza l'anomalia rispetto allo stesso periodo dell'anno scorso (ERA5). |
| **Allerte Protezione Civile**| `pc_allerte` | Recupera l'ultimo bollettino di criticità dal canale ufficiale GitHub del DPC. |
| **Nowcasting Radar** | `dpc_radar` | Ottiene l'ultimo GeoTIFF pre-firmato della rete radar nazionale (VMI, SRI, ecc.). |
| **Osservazioni METAR** | `checkwx_metar_taf`<br>`aviationweather_metar` | Validazione aeronautica con stazioni aeroportuali ICAO in tempo reale. |
| **Rete Fulmini** | `dmi_lightning` | Strike di fulmini orari con distanza relativa (nearestKm) rispetto alle coordinate. |
| **Previsioni & IDRO ARPA**| `arpav_bollettino`, `arpav_idro`<br>`meteotrentino_osservazioni`<br>`arpae_bollettino`<br>`arpafvg_previsioni`, `arpafvg_stazione`<br>`arpa_marche_stazioni`, `arpa_marche_stazione`<br>`arpa_lombardia_stazioni`, `arpa_lombardia_osservazioni`<br>`arpa_piemonte_stazioni` | Reti di osservazione e bollettini testuali regionali in tempo reale (Veneto, Trentino, Emilia-Romagna, FVG, Marche, Lombardia, Piemonte). |

---

## 1. Climatologia ERA5 & Indici Bioclimatici
*   **Tool core**: `meteo_climatology` / `meteo_bioclimatic_indices` / `open_meteo_seasonal`
*   **Anomalie**: Utilizzare le medie storiche ERA5 per calcolare lo scostamento (anomalia) termico e pluviometrico attuale.
*   **THI (Temperature-Humidity Index)**: `THI = (1.8 * T + 32) - [(0.55 - 0.0055 * RH) * (1.8 * T - 26)]`. Soglia di stress per il bestiame/biometeorologia: onset a 68 (lieve), grave a 79, emergenza a 90.
*   **Vapor Pressure Deficit (VPD)**: Calcolato via `meteo_bioclimatic_indices`. Soglie: <0.4 kPa (basso/umido), 0.8-1.5 kPa (alto/stress traspirativo), >1.5 kPa (critico per vegetazione e innesco incendi).
*   **Nimbus Fire Intelligence (NFR)**: Rischio incendi basato su VPD (>1.5 kPa), umidità suolo superficiale (<0.15 m³/m³) e velocità del vento (>25 km/h).

---

## 2. Calibrazione, Pesi e Bias dei Modelli
*   **Tool core**: `meteo_model_tuning` / `meteo_verification`
*   **Weights per Macroarea**:
    *   *Nord-Ovest*: Priorità a `icon_d2` (1.4), `ecmwf_ifs025` (1.3), `meteoswiss_icon_seamless` (1.3), `italia_meteo_arpae_icon_2i` (1.2).
    *   *Nord-Est*: Priorità a `italia_meteo_arpae_icon_2i` (1.5), `icon_d2` (1.4), `ecmwf_ifs025` (1.2).
    *   *Centro-Nord*: Priorità a `italia_meteo_arpae_icon_2i` (1.5), `ecmwf_ifs025` (1.3).
    *   *Centro / Sud / Isole*: `ecmwf_ifs025` (1.5-1.6) come backbone assoluto.
*   **UHI (Urban Heat Island)**: Correzione termica per i centri urbani in notti serene e con vento calmo: Milano (+2.5°C Tmin), Roma (+2.0°C Tmin), Torino (+2.0°C Tmin), Firenze (+2.5°C Tmin), Bari (+4.0°C Tmin), Palermo (+2.5°C Tmin).
*   **Bias noti**:
    *   `italia_meteo_arpae_icon_2i` tende ad anticipare le piogge di 1-3 ore sul versante adriatico e a sovrastimare la pioggia orografica (+20-40%) sulle Prealpi venete e Appennino emiliano. Eccelle nel risolvere le nebbie padane.
    *   `ecmwf_ifs025` tende a smussare i picchi precipitativi convettivi estremi (-10-20%) ma individua in anticipo le ondate di calore.
    *   `gfs_seamless` sovrastima l'intensità dello Scirocco al Sud ed ha un bias caldo estivo (+1-2°C).

---

## 3. Rete ARPA e Monitoraggio Regionale
*   **Tool core**: `arpav_*` / `meteotrentino_*` / `arpae_*` / `arpafvg_*` / `arpa_marche_*` / `arpa_lombardia_*` / `arpa_piemonte_*`
*   **Osservazioni Real-time**: Da preferire per validare i modelli numerici in tempo reale.
*   **Copertura**: Se la regione non è coperta da API aperta, dichiarare lo stato `nonCoperto` nel brief ed effettuare il fallback sui METAR aeroportuali o sul radar nazionale.

---

## 4. Monitoraggio Idrologico & Rischio Alluvioni
*   **Tool core**: `open_meteo_flood` (GloFAS v4 a 5km) / `floods_it_monitoring` (Trentino) / `arpav_idro` (Veneto) / `meteo_reference_guidelines` (categoria: `hydro`)
*   **Soglie Idrometriche Nazionali**:
    *   *Fiume Reno (Casalecchio Chiusa)*: Soglia 1: 0.80m | Soglia 2: 1.60m | Soglia 3: 2.20m.
    *   *Fiume Po*: Monitorare le sezioni AIPO (Piacenza S1: 5.0m, Cremona S1: 2.2m, Pontelagoscuro S1: 0.5m).
    *   *Fiume Arno*: Nave di Rovezzano (S1: 3.0m, S3: 4.5m), Firenze Uffizi (S1: 3.0m, S3: 5.5m).
    *   *Fiume Tevere (Roma Ripetta)*: Soglia 1: 7.0m | Soglia 2: 10.0m | Soglia 3: 12.5m.
    *   *Fiume Volturno (Capua)*: Consultare il Bollettino Multirischi della Campania (piena storica ~8.20m).

---

## 5. Nowcasting: Radar DPC, Fulmini e Satellite
*   **Tool core**: `dpc_radar` / `dmi_lightning` / `eumetsat_satellite_info` / `meteo_reference_guidelines` (categorie: `nowcasting`, `lightning`, `satellite`)
*   **Riflettività VMI (dBZ)**:
    *   15-20 dBZ: Pioviggine o nubi dense.
    *   20-35 dBZ: Pioggia debole/moderata.
    *   35-45 dBZ: Pioggia forte, rovescio temporalesco.
    *   45-55 dBZ: Temporale severo, grandine piccola.
    *   >55 dBZ: Temporale violento, grandine di grosse dimensioni altamente probabile.
*   **Nowcasting Blending Matrix**:
    *   0-15m: 100% Radar (estrapolazione VMI)
    *   15-45m: 80% Radar / 20% NWP (ICON-D2 / AROME)
    *   45-90m: 40% Radar / 60% NWP (correzione temporale di anticipo/ritardo)
    *   >120m: 100% NWP (ICON-D2 / ECMWF IFS)
*   **Fulmini (DMI)**: Soglia di severità temporale basata sulla densità in 15 minuti per 50 km² (>10: temporale organizzato; >20: supercella/grandine). Pericolo immediato se gli strike rilevati sono a distanza <5 km.

---

## 6. Qualità dell'Aria e Pollini
*   **Tool core**: `open_meteo_air_quality` (CAMS) / `meteo_pollen` / `meteo_reference_guidelines` (categoria: `air_quality`)
*   **Scala AQI Europea**: Classificazione standard basata sulle concentrazioni orarie di PM2.5 (scarso >25 µg/m³), PM10 (scarso >50 µg/m³), e NO2 (scarso >120 µg/m³).
*   **Strato di Rimescolamento (Boundary Layer)**: Se l'altezza di miscelazione è <300m, sussiste un rischio estremo di accumulo di PM10/NO2 (tipico delle inversioni termiche invernali in Pianura Padana).
*   **Protocollo Aria Padana**: Livello 1 (Arancio) attivato dopo 2 giorni consecutivi di PM10 > 50 µg/m³ (blocco veicoli inquinanti). Livello 2 (Rosso) attivo con PM10 > 75 µg/m³.

---

## 7. Montagna, Neve e Mare
*   **Tool core**: `open_meteo_marine` / `meteo_bioclimatic_indices` / `meteo_reference_guidelines` (categorie: `mountain`, `marine`)
*   **Quota Neve Nimbus (Snow-Line)**:
    `Quota Neve = Zero Termico (Freezing Level) - (300m + Correttivo Intensità + Correttivo Valle + Correttivo Umidità)`
    *   *Correttivo Intensità*: 100m per precipitazione moderata (2-5 mm/h), fino a 500m per precipitazione violenta (>10 mm/h, per omotermia da fusione).
    *   *Correttivo Valle*: +150m di discesa della neve in valli alpine strette e racchiuse.
    *   *Correttivo Umidità*: +100m con aria secca (RH <70%), -100m con aria molto umida (RH >90%).
*   **Stato del Mare (Douglas)**:
    *   Mosso: 0.50 - 1.25m (cautela piccola nautica)
    *   Molto mosso: 1.25 - 2.50m (sconsigliato per piccola nautica)
    *   Agitato: 2.50 - 4.00m (pericolo)
*   **Traversia Costiera Critica (Rischio Mareggiate)**:
    *   *Liguria di Levante*: Traversia 200°-240° (Libeccio, soglia critica onda: 3.0m).
    *   *Sardegna Ovest*: Traversia 270°-320° (Maestrale, soglia critica onda: 4.0m).
    *   *Alto Adriatico / Romagna*: Traversia 60°-120° (Bora/Levante, soglia critica onda: 2.0m).
    *   *Laguna di Venezia*: Traversia 120°-160° (Scirocco, soglia critica onda: 1.5m).

---

## 8. Aviazione & Portali di Fallback
*   **Tool core**: `checkwx_metar_taf` / `meteo_reference_guidelines` (categorie: `aviation`, `portals`)
*   **Validazione METAR**: ICAO principali: LIMC (Malpensa), LIML (Linate), LIRF (Fiumicino), LIRN (Napoli), LICC (Catania), LICJ (Palermo). Uno scostamento termico >2°C o di vento >10 nodi indica un locale fallimento dei modelli NWP.
*   **Consensus Portali Esterni**: In caso di fallimento delle API principali, confrontare i dati dei portali 3bMeteo, iLMeteo e Meteo.it dichiarando la fonte.
