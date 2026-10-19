---
name: meteo-italia
description: >
  Analisi meteo multi-modello Italia. Previsioni, confronto ECMWF/ICON/GFS, fenomeni locali (foehn, bora, scirocco), qualità aria, nowcasting temporali. Trigger: qualsiasi domanda meteo su città/regione italiana.
---

# Weather Forecast Analysis — Italia

## Trigger Keywords
"meteo", "previsioni", "pioggia", "neve", "allerta", "vento", "bora", "scirocco", "foehn", "temporale", "grandine", "mare", "montagna", "ghiaccio", "nebbia", "acqua alta", "modelli meteo".

---

Analisi comparativa multi-modello specializzata per il territorio italiano.
Integra: previsioni numeriche (Open-Meteo), osservazioni in tempo reale (reti ARPA regionali),
climatologia di riferimento (ERA5) e bias noti dei modelli.

---

## Bootstrap obbligatorio

⚠️ **STRATEGIA MCP-FIRST OBBLIGATORIA**:
L'intero progetto adotta una filosofia **MCP-First**. L'intera base di conoscenza dettagliata (tabelle, scale, regole di calcolo, soglie, codici, bias) è caricata nel server MCP ed è riassunta nell'unico file consolidato di riferimento `references/mcp_reference.md`.

Se il server MCP è disponibile nell'ambiente, **NON caricare alcun file di reference in contesto**. Usa direttamente i tool MCP dedicati per ottenere climatologia, indici bioclimatici avanzati, bias dei modelli, affidabilità, linee guida e riconoscimento dei fenomeni locali al volo.

Se l'ambiente non supporta MCP, l'agente opererà in modalità `🧠 Stima interna` — basandosi esclusivamente sulla propria conoscenza interna, senza accesso a dati reali. In questo caso, **dichiarare esplicitamente** il badge `🔴 STIMA` nel report e non produrre numeri specifici senza fonte verificata.

---

## MCP Server (meteo-italia-mcp-server)

Le chiamate alle API esterne e le basi di conoscenza meteorologiche sono esposte come **tool MCP**. Se l'ambiente fornisce questo server, **USA I TOOL al posto dei fetch HTTP grezzi e dei file di reference locali**: gestiscono errori, cache, rate-limit e calcoli complessi.

**Mappatura step/riferimenti → tool MCP (Dettagli in `references/mcp_reference.md`):**

| Step | Nome / Servizio | Tool MCP Principale |
|---|---|---|
| **0** | **Aggregatore Multi-Fonte** | `meteo_brief` (NWP pesato per macroarea + allerte PC + radar + METAR + ARPA + ensemble) |
| **Geocoding** | Risoluzione coordinate | `open_meteo_geocode` (filtro `country_code == 'IT'`) |
| **Step A** | Previsioni numeriche (NWP) | `open_meteo_forecast` / `open_meteo_forecast_summary` |
| **Step B** | Climatologia ERA5 | `meteo_climatology` / `open_meteo_archive` |
| **Step E** | Allerta Protezione Civile | `pc_allerte` (comune/regione) |
| **Step D** | Osservazioni ARPA regionali| `arpav_*`, `meteotrentino_*`, `arpae_*`, `arpafvg_*`, `arpa_marche_*`, `arpa_lombardia_*`, `arpa_piemonte_*` |
| **Step F** | Condizioni Marine | `open_meteo_marine` |
| **Step H** | Qualità aria & Pollini | `open_meteo_air_quality` / `meteo_pollen` |
| **Step I** | Nowcasting Radar DPC | `dpc_radar` (VMI) |
| **Step J** | Incertezza & Ensemble | `open_meteo_ensemble` |
| **Step K** | Validazione METAR/TAF | `checkwx_metar_taf` / `aviationweather_metar` |
| **Step L** | Rete Fulmini | `dmi_lightning` |
| **Step M** | Rischio Idrico & Fiumi | `floods_it_monitoring` / `arpav_idro` / `open_meteo_flood` (GloFAS) |
| **Step N** | Satellite Meteosat | `eumetsat_satellite_info` |
| **Riferimenti**| Matrici & Scale statiche | `meteo_reference_guidelines` (categorie: `models`, `marine`, `air_quality`, `mountain`, `hydro`, `nowcasting`, `satellite`, `lightning`, `aviation`, `portals`, `pollen`, `uv`, `construction`, `tourism`) |
| **Riferimenti**| Calibrazione, Pesi & UHI | `meteo_model_tuning` |
| **Riferimenti**| Indici & Formule fisiche | `meteo_bioclimatic_indices` |
| **Riferimenti**| Affidabilità forecast | `meteo_event_reliability` |
| **Riferimenti**| Verifica Storica & YoY | `meteo_verification` / `meteo_year_compare` |

---

## Flusso di lavoro

### 1. Determina Parametri
Identifica subito: **luogo, periodo, variabili, use case, macroarea geografica** (per pesare i modelli) e **regione amministrativa** (per ARPA e allerte).
*Response Mode:* **Lite** (sintesi rapida) o **Pro** (analisi dettagliata e use case).

### 2. Geocoding
Risolvi le coordinate via `open_meteo_geocode` con `count=10`. Filtra strettamente per `country_code == 'IT'`. In caso di omonimi (>3 corrispondenze), chiedi chiarimenti all'utente.

### 3. Fetch sequenziale prioritizzato

**STEP 0 (MANDATORIO): `meteo_brief`**
Chiama sempre `meteo_brief` prima di procedere. Analizza il report sintetico del brief e interroga i singoli tool specifici di Tier 1, 2 e 3 solo in presenza di anomalie, divergenze o per approfondire use case.

Esegui il workflow in 3 Tier. Completa il **TIER 1** prima di procedere al **TIER 2**.
*Regola del contesto:* Se il contesto dell'agente supera 80k token dopo il TIER 1, esegui solo i passi di TIER 2 con condizione attiva (`TRUE`) e salta completamente il TIER 3.

| Tier | Step | Nome | Condizione di Attivazione | Riferimenti |
|---|---|---|---|---|
| **TIER 1** | **A** | Previsioni numeriche (NWP) | Sempre | `meteo_model_tuning` |
| | **B** | Climatologia ERA5 | Sempre | `meteo_climatology` |
| | **E** | Allerta Protezione Civile | Sempre | `pc_allerte` |
| **TIER 2** | **D** | Osservazioni ARPA | Sempre (dove coperte) | Tool ARPA regionali |
| | **F** | Dati marini | Se costiero/nautico | `open_meteo_marine` |
| | **H** | Qualità aria CAMS / Pollini | Pianura Padana (ott-mar), salute, fioritura, scirocco | `open_meteo_air_quality` / `meteo_pollen` |
| | **J** | Ensemble Spread | Orizzonte >3gg, eventi intensi, divergenza modelli | `open_meteo_ensemble` |
| **TIER 3** | **I** | Nowcasting Radar DPC | Allerta ≥gialla, precipitazioni orarie, short-term | `dpc_radar` |
| | **K** | METAR/TAF | Validazione locale, aeroporti, divergenza NWP >2°C | `checkwx_metar_taf` |
| | **L** | Rete Fulmini | Allerta temporali, outdoor, attività elettrica | `dmi_lightning` |
| | **M** | Monitoraggio Fiumi & Idro | Allerta idro, pioggia >30mm/24h, cumulata 7gg >100mm | Tool idro / `open_meteo_flood` |
| | **N** | Satellite Meteosat | Allerta ≥gialla, nebbia prevista, divergenza >1.5σ | `eumetsat_satellite_info` |

*Nota: Lo Step C (Storico 7gg) e G (UV Index) sono estratti o calcolati direttamente dallo Step A.*

---

### 4. Analisi Comparativa & Raffinamenti (Dettagli in `references/mcp_reference.md`)

-   **Consensus multi-modello**: `meteo_brief` calcola già il consensus pesato per macroarea (`nwp.macroarea`, `nwp.pesi`, `tmaxPesata`/`tminPesata`/`precipPesataMm`): usa quelli, non rifare la media. `meteo_model_tuning` serve solo per bias e scenari dinamici.
-   **Effetto Isola di Calore (UHI)**: Correggi le temperature minime/massime dei grandi centri urbani in condizioni ottimali via `meteo_model_tuning`.
-   **Quota Neve Nimbus**: Calcola il limite dell'accumulo nevoso con la formula di omotermia umida ed intensità precipitativa via `meteo_bioclimatic_indices`.
-   **Rischio Incendi (NFR)**: Valuta le condizioni fisiche di accensione tramite VPD, vento e umidità del suolo via `meteo_bioclimatic_indices`.
-   **Nowcasting Blending**: Combina i dati radar con il NWP usando la matrice di decadimento temporale (100% radar a 15m -> 100% NWP oltre i 120m).

---

## Use Case Specializzati
Riconosci il contesto dall'input e calcola soglie/indici tramite `meteo_bioclimatic_indices` e `references/mcp_reference.md`:
-   🏔️ **Montagna**: Quota neve, pericolo valanghe (AINEVA), Wind Chill, temporali, Ski Index.
-   🐝 **Apicoltura**: Finestre di volo api, secrezione nettarifera (acacia, castagno).
-   ⚽ **Outdoor / Sport**: Probabilità pioggia oraria, vento per strutture, fulmini.
-   🌾 **Agricoltura**: Gelate tardive, bagnatura fogliare, GDD, bilancio idrico a 7gg, regola dei tre dieci per peronospora vite.
-   🏗️ **Cantiere**: Limiti vento gru/ponteggi, getto calcestruzzo (temperatura, pioggia, gelo).
-   🚗 **Viabilità**: Neve, nebbia, gelicidio (black ice), pioggia intensa.
-   🏖️ **Mare / Nautica**: Douglas (stato mare), Beaufort (vento), traversia costiera, Beach Index.
-   🌡️ **Salute & Comfort**: Heat Index, THI stress bestiame, AQI, pollini.
-   ⚡ **Energia (Eolico/Solare)**: Vento a 80-120m, cut-in/cut-out e rated power, irraggiamento, efficienza fotovoltaica.

---

## Template Report

### 📋 Execution Manifest (SOLO SU RICHIESTA)
Mostrare la tabella dello stato di fetch delle fonti **solo se l'utente la richiede esplicitamente** (es. debug, verifica fonti). Non includerla nei report di default. Se lo **Step A** è in stato "**🧠 Stima interna**", premettere comunque un banner di avviso in rosso all'inizio del report.

| Step | Nome Fonte / Tool | Stato | Fonte Dati | Livello Fetch (A) | Timestamp |
|---|---|---|---|---|---|
| **A** | Previsioni numeriche (NWP) | ✅ / ⚠️ / ❌ / 🧠 | | 1 / 2 / 3 | |
| **B** | Climatologia ERA5 | | | - | |
| ... | ... | ... | ... | ... |

*(Stati: ✅ Eseguito con successo, ⚠️ Eseguito parzialmente/cached, ❌ Saltato, 🧠 Stima interna)*

### 🎖️ Regola Generale per i Badge di Confidenza
Per evitare la ridondanza visiva e il consumo eccessivo di token nel prompt, i template sottostanti sono definiti in modo asciutto. **Tuttavia, l'agente deve applicare la seguente regola ferrea nella generazione dell'output**:
Ogni singola intestazione principale (`##`) e secondaria (`###`) del report finale deve terminare con il rispettivo badge di confidenza in base all'origine del dato:
-   `[🟢 REALE]` se i dati provengono da un fetch in tempo reale effettuato nella sessione corrente (es. radar, osservazioni ARPA, METAR, bollettini recenti).
-   `[🟡 PARZIALE]` se i dati sono parziali, provengono da cache o presentano parziali anomalie di acquisizione.
-   `[🔴 STIMA]` se i dati derivano dalla conoscenza interna dell'LLM (stima qualitativa), da archivi non aggiornati o se la fonte di Step A è `🧠 Stima interna`.

---

### 🟢 Report Sintetico (Response Mode: LITE)

## 🌤️ Meteo {LUOGO} — {DATA} `[BADGE]`
**Sintesi**: {Breve descrizione del cielo, precipitazioni, vento, temperature}
**🌡️ Temperatura**: {min} / {max}°C (Percepita massima: {max_app}°C)
**🚨 Allerta**: {Semaforo del livello e tipologia di criticità Protezione Civile}
**☔ Precipitazioni**: {Probabilità pioggia}% | Accumulo stimato: {range mm}
**💨 Vento**: {velocità} km/h con raffiche a {max_raf} km/h da {DIREZIONE}

---

### 🔵 Report Completo (Response Mode: PRO)

## 🌤️ Analisi Meteo — {LUOGO} ({REGIONE}) — {DATA} `[BADGE]`

{⚠️ ALERT: UTILIZZO FONTI ESTERNE - Da includere in rosso solo se Open-Meteo è fallito e si è ricorso a portali manuali}

### 📡 Nowcasting Radar (0-6h) (Step I) `[BADGE]`
{Analisi qualitativa della riflettività dBZ VMI ed evoluzione cellulare, oppure fallback se non attivo}

### 🚨 Allerta Protezione Civile (Step E) `[BADGE]`
{Livello colore e dettaglio zone di allertamento per rischio idraulico, idrogeologico, temporali}

### 📅 Ultimi 7 giorni (Step C) `[BADGE]`
{Accumuli settimanali, scostamenti e stato del bilancio idrico Nimbus}

### 📊 Confronto Climatologico (Step B) `[BADGE]`
{Anomalia termica e pluviometrica rispetto alle medie ERA5 1991-2020 per la stazione di riferimento}

### 📡 Osservazioni Reali ARPA (Step D) `[BADGE]`
{Valori registrati dalle stazioni regionali più vicine, scostamento rispetto alla previsione NWP}

### 🌡️ Temperature e Sensazione Termica `[BADGE]`
{Dettaglio Tmin/Tmax, percepite, livello di afa (Heat Index) o Wind Chill, correzione UHI urbana}

### ☔ Precipitazioni e Fenomeni Convettivi `[BADGE]`
{Modelli concordi/discordi, millimetri attesi, CAPE/Lifted Index, rischio grandine o quota neve Nimbus}

### 💨 Vento e Fenomeni Locali Speciali `[BADGE]`
{Velocità, raffiche massime, flag di attivazione fenomeni locali: Foehn, Bora, Scirocco, Maccaja, ecc.}

### 🌊 Condizioni Marine (Step F) `[BADGE]`
{Scala Douglas per mare e swell, Beaufort, SST, traversia costiera e idoneità nautica}

### 💨 Qualità dell'Aria e Pollini (Step H) `[BADGE]`
{Indice AQI europeo, inquinanti dominanti, altezza boundary layer, rischio pollini per allergeni attivi}

### ✈️ Validazione METAR Aeroportuale (Step K) `[BADGE]`
{Codice ICAO, confronto parametri reali T/Vento vs previsioni, nubi e visibilità}

### ⚡ Rilevamento Fulmini (Step L) `[BADGE]`
{Strikes recenti, trend di intensificazione, distanza dal target e rischio temporali violenti}

### 🌊 Dati Idrologici (Step M) `[BADGE]`
{Livello idrometrico dei fiumi limitrofi, superamento soglie d'allerta locali, trend e portata GloFAS}

### 🛰️ Satellite (Step N) `[BADGE]`
{Analisi qualitativa canali visibile/infrarosso, transito fronti perturbati, nebbia o polvere sahariana}

### 📊 Incertezza ed Ensemble Spread (Step J) `[BADGE]`
{Concordanza probabilistica dei modelli, spread percentili T e pioggia}

### ⚠️ Sintesi Anomalie e Incertezze `[BADGE]`
{Spiegazione fisica dei meccanismi in gioco e divergenze principali tra i modelli ad alta e bassa risoluzione}

### 📋 Raccomandazione Operativa `[BADGE]`
{Scenario finale ritenuto più probabile ed indicazioni pratiche/consigli personalizzati per lo use case richiesto}

---
Fonti: Open-Meteo, ARPA regionali, DPC, CheckWX, EUMETSAT, DMI, floods.it.

---

## Note Operative ed Error Handling

-   **Fuso Orario**: Impostare sempre `timezone=Europe/Rome` (non `auto`).
-   **Quota Montana**: Se la quota è >1500m, impostare manualmente l'altezza (`elevation`) nel fetch NWP.
-   **Strategia di Fallback (Open-Meteo down)**:
    1. Richiedere le linee guida sui portali di fallback (`references/mcp_reference.md`).
    2. Dichiarare *"dati NWP non disponibili"*, omettere i dati numerici specifici senza fonte e compilare unicamente le sezioni E (allerte), D (ARPA) ed una descrizione qualitativa basata sul clima.
-   **Rate Limiting & Retries**: Gestiti direttamente a livello di server MCP.
