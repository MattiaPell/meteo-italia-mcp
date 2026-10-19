import { describe, it, expect } from "vitest";
import { dmsToDecimal, parseStationList, parseStationDetail } from "../regioni/arpa-marche.js";
import { parseStation } from "../regioni/arpa-lombardia.js";
import { formatGiorno } from "../regioni/arpae.js";
import { parsePrevisioniXml, parseWfsStazioni, parseStazioneXml } from "../regioni/arpa-fvg.js";

// ---------------------------------------------------------------------------
// ARPA Marche
// ---------------------------------------------------------------------------

describe("dmsToDecimal", () => {
  it("converts DMS string with positive degrees", () => {
    const result = dmsToDecimal(`43°36'6.340''`);
    expect(result).toBeCloseTo(43.60176, 5);
  });

  it("converts DMS string with negative degrees (lon ovest)", () => {
    // longitude like 12°33'9.799'' — positive
    const result = dmsToDecimal(`12°33'9.799''`);
    expect(result).toBeCloseTo(12.55272, 5);
  });

  it("handles integer seconds", () => {
    const result = dmsToDecimal(`12°56'52''`);
    expect(result).toBeCloseTo(12.94778, 5);
  });

  it("returns 0 for unparseable input", () => {
    expect(dmsToDecimal("")).toBe(0);
    expect(dmsToDecimal("not-dms")).toBe(0);
  });

  it("handles zero degrees", () => {
    const result = dmsToDecimal(`0°30'0''`);
    expect(result).toBeCloseTo(0.5, 5);
  });

  it("uses DMS when latitudine/longitudine decimal fields are 0", () => {
    // station data may have latString but latitudine=0
    const raw = {
      lista: [
        {
          codice: "ST99",
          nome: "Test",
          comune: "Test",
          provincia: "AN",
          latString: `43°36'6.340''`,
          longString: `12°33'9.799''`,
          latitudine: 0,
          longitudine: 0,
          altitudine: "295",
          statoCodice: "ATTIVA",
          proprietario: "AMAP",
          fine: "2026-07-21T06:10:00",
        },
      ],
    };
    const stations = parseStationList(raw);
    expect(stations[0].latitudine).toBeCloseTo(43.60176, 4);
    expect(stations[0].longitudine).toBeCloseTo(12.55272, 4);
  });
});

describe("parseStationList", () => {
  it("parses multiple stations from raw API response", () => {
    const raw = {
      totale: 3,
      lista: [
        {
          codice: "ST60",
          nome: "Acqualagna",
          comune: "Acqualagna",
          provincia: "PU",
          latitudine: 43.60176,
          longitudine: 12.55272,
          altitudine: "295",
          statoCodice: "ATTIVA",
          proprietario: "AMAP",
          fine: "2026-07-21T06:10:00",
        },
        {
          codice: "ST32",
          nome: "Agugliano",
          comune: "Agugliano",
          provincia: "AN",
          latitudine: 43.54029,
          longitudine: 13.37633,
          altitudine: "140",
          statoCodice: "ATTIVA",
          proprietario: "AMAP",
          fine: "2026-07-21T06:10:00",
        },
        {
          codice: "ST08",
          nome: "Carassai",
          comune: "Carassai",
          provincia: "AP",
          latitudine: 43.04016,
          longitudine: 13.68021,
          altitudine: "210",
          statoCodice: "ATTIVA",
          proprietario: "AMAP",
          fine: "2026-07-21T06:10:00",
        },
      ],
    };
    const stations = parseStationList(raw);
    expect(stations).toHaveLength(3);
    expect(stations[0].codice).toBe("ST60");
    expect(stations[0].nome).toBe("Acqualagna");
    expect(stations[0].provincia).toBe("PU");
    expect(stations[0].attiva).toBe(true);
    expect(stations[0].altitudine).toBe(295);
    expect(stations[0].ultimoAggiornamento).toBe("2026-07-21T06:10:00");
    expect(stations[0].sensori).toEqual([]);
  });

  it("handles empty lista", () => {
    expect(parseStationList({})).toEqual([]);
    expect(parseStationList({ lista: [] })).toEqual([]);
  });

  it("handles missing fields gracefully", () => {
    const raw = { lista: [{ codice: "ST01" }] };
    const stations = parseStationList(raw);
    expect(stations).toHaveLength(1);
    expect(stations[0].nome).toBe("");
    expect(stations[0].latitudine).toBe(0);
    expect(stations[0].attiva).toBe(false);
  });

  it("uses DMS fallback when latitudine is missing but latString exists", () => {
    const raw = {
      lista: [
        {
          codice: "ST70",
          nome: "Cagli",
          latString: `43°36'54.734''`,
          longString: `12°41'57.113''`,
          statoCodice: "ATTIVA",
        },
      ],
    };
    const stations = parseStationList(raw);
    expect(stations[0].latitudine).toBeCloseTo(43.6152, 3);
    expect(stations[0].longitudine).toBeCloseTo(12.6992, 3);
  });
});

describe("parseStationDetail", () => {
  it("adds sensor list to base station", () => {
    const base = {
      codice: "ST01",
      nome: "Maltignano",
      comune: "Maltignano",
      provincia: "AP",
      latitudine: 42.84227,
      longitudine: 13.69877,
      altitudine: 114,
      attiva: true,
      proprietario: "AMAP",
      ultimoAggiornamento: "2026-07-21T06:20:00",
      sensori: [],
    };
    const raw = {
      altitudine: "114",
      listaSensori: {
        totale: 3,
        lista: [
          {
            idSensoreStazione: 1,
            idSensoreClasse: 1,
            descrizioneClasse: "Sensore di temperatura in aria a m. 1.50 dal suolo",
            haGiornalieri: true,
            haMensili: true,
            haAnnuali: true,
            haGrafico: true,
          },
          {
            idSensoreStazione: 7,
            idSensoreClasse: 7,
            descrizioneClasse: "Sensore di vento a m. 10 dal suolo",
            haGiornalieri: true,
            haMensili: false,
            haAnnuali: false,
            haGrafico: false,
          },
          {
            idSensoreStazione: 10,
            idSensoreClasse: 10,
            descrizioneClasse: "Sensore di precipitazione",
            haGiornalieri: true,
            haMensili: true,
            haAnnuali: true,
            haGrafico: true,
          },
        ],
      },
    };
    const detail = parseStationDetail(raw, base);
    expect(detail.sensori).toHaveLength(3);
    expect(detail.sensori[0].id).toBe(1);
    expect(detail.sensori[0].tipo).toContain("temperatura");
    expect(detail.sensori[0].haGiornalieri).toBe(true);
    expect(detail.sensori[1].tipo).toContain("vento");
    expect(detail.sensori[2].tipo).toContain("precipitazione");
  });

  it("handles missing sensor list", () => {
    const base = {
      codice: "ST99",
      nome: "Test",
      comune: "Test",
      provincia: "AN",
      latitudine: 0,
      longitudine: 0,
      altitudine: 0,
      attiva: true,
      proprietario: "AMAP",
      ultimoAggiornamento: null,
      sensori: [],
    };
    const detail = parseStationDetail({}, base);
    expect(detail.sensori).toEqual([]);
  });

  it("updates altitudine from detail when present", () => {
    const base = {
      codice: "ST01",
      nome: "Maltignano",
      comune: "Maltignano",
      provincia: "AP",
      latitudine: 42.84227,
      longitudine: 13.69877,
      altitudine: 0,
      attiva: true,
      proprietario: "AMAP",
      ultimoAggiornamento: null,
      sensori: [],
    };
    const detail = parseStationDetail({ altitudine: "114" }, base);
    expect(detail.altitudine).toBe(114);
  });
});

// ---------------------------------------------------------------------------
// ARPA Lombardia
// ---------------------------------------------------------------------------

describe("parseStation (ARPA Lombardia / Socrata)", () => {
  it("parses a Socrata row with all fields", () => {
    const row = {
      idsensore: "14399",
      tipologia: "Temperatura",
      unit_dimisura: "°C",
      idstazione: "1365",
      nomestazione: "Bione",
      quota: "911",
      provincia: "BS",
      lat: "45.66721826",
      lng: "10.32736288",
    };
    const station = parseStation(row);
    expect(station.idsensore).toBe("14399");
    expect(station.tipologia).toBe("Temperatura");
    expect(station.unitaMisura).toBe("°C");
    expect(station.nomeStazione).toBe("Bione");
    expect(station.quota).toBe(911);
    expect(station.provincia).toBe("BS");
    expect(station.lat).toBeCloseTo(45.66721826, 8);
    expect(station.lon).toBeCloseTo(10.32736288, 8);
  });

  it("parses a precipitation sensor row", () => {
    const row = {
      idsensore: "9999",
      tipologia: "Precipitazione",
      unit_dimisura: "mm",
      idstazione: "2001",
      nomestazione: "Milano Centro",
      quota: "120",
      provincia: "MI",
      lat: "45.46427",
      lng: "9.18951",
    };
    const station = parseStation(row);
    expect(station.tipologia).toBe("Precipitazione");
    expect(station.unitaMisura).toBe("mm");
    expect(station.lat).toBeCloseTo(45.46427, 5);
  });

  it("handles missing optional fields", () => {
    const row = {
      idsensore: "7777",
      tipologia: "Vento",
      unit_dimisura: "m/s",
      idstazione: "42",
      nomestazione: "Stazione Test",
      provincia: "SO",
      lat: "46.0",
      lng: "9.5",
    };
    const station = parseStation(row);
    expect(station.quota).toBeNull();
    expect(station.nomeStazione).toBe("Stazione Test");
  });

  it("handles empty lat/lng as 0", () => {
    const row = {
      idsensore: "1",
      tipologia: "Temperatura",
      unit_dimisura: "°C",
      idstazione: "1",
      nomestazione: "Empty",
      provincia: "MI",
    };
    const station = parseStation(row);
    expect(station.lat).toBe(0);
    expect(station.lon).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ARPAE Emilia-Romagna
// ---------------------------------------------------------------------------

describe("formatGiorno (ARPAE)", () => {
  it("extracts regionale + tabellare + provinciale for a day", () => {
    const data = {
      oggi: {
        bollettino: {
          validita: "2026-07-21",
          emissione: "2026-07-21T12:00:00",
          regionale: {
            testo: { cielo: "Sereno", temperatura: "28-32", vento: "Debole", mare: "Calmo" },
            dati_tabellari: {
              costa: { tmin_previ: 20, tmax_previ: 30, precipitazioni: "0" },
              pianura: { tmin_previ: 18, tmax_previ: 34, precipitazioni: "0" },
            },
          },
          provinciale: {
            BO: { testo_previsione: "Sereno", temperatura_minima: 18, temperatura_massima: 32 },
          },
        },
      },
    };
    const g = formatGiorno("oggi", data);
    expect(g).toHaveProperty("validita", "2026-07-21");
    expect(g).toHaveProperty("emissione", "2026-07-21T12:00:00");
    expect(g.regionale?.cielo).toBe("Sereno");
    expect(g.dati_tabellari?.costa.tmin).toBe(20);
    expect(g.provinciale?.BO.testo).toBe("Sereno");
  });

  it("returns empty object for missing day", () => {
    expect(formatGiorno("oggi", {})).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// ARPA FVG / OSMER
// ---------------------------------------------------------------------------

describe("parsePrevisioniXml (ARPA FVG)", () => {
  it("parses emissione, situazione generale, and scadenze with zone", () => {
    const xml = `<previsioni>
      <emissione>2026-07-21T12:00:00</emissione>
      <lingua>it</lingua>
      <SITUAZIONEGENERALE_TESTO>Alta pressione sul Nord Italia</SITUAZIONEGENERALE_TESTO>
      <scadenze>
        <scadenza id="1" data_validita="2026-07-21" giorno="oggi">
          <zona id="10" nome="REGIONE" descrizione="Tutto il FVG">
            <ATTENDIBILITA>90</ATTENDIBILITA>
            <TESTO>Cielo sereno o poco nuvoloso</TESTO>
            <PROBABILITAPRECIPITAZIONI>5</PROBABILITAPRECIPITAZIONI>
            <PROBABILITATEMPORALI>0</PROBABILITATEMPORALI>
            <QUOTANEVICATA>2000</QUOTANEVICATA>
            <EVOLUZIONE00_SIMBOLO>1</EVOLUZIONE00_SIMBOLO>
            <EVOLUZIONE00_DESCRIZIONE>Sereno</EVOLUZIONE00_DESCRIZIONE>
            <EVOLUZIONE12_SIMBOLO>2</EVOLUZIONE12_SIMBOLO>
            <EVOLUZIONE12_DESCRIZIONE>Poco nuvoloso</EVOLUZIONE12_DESCRIZIONE>
            <EVOLUZIONE24_SIMBOLO>4</EVOLUZIONE24_SIMBOLO>
            <EVOLUZIONE24_DESCRIZIONE>Coperto</EVOLUZIONE24_DESCRIZIONE>
          </zona>
        </scadenza>
      </scadenze>
    </previsioni>`;
    const p = parsePrevisioniXml(xml) as any;
    expect(p.emissione).toBe("2026-07-21T12:00:00");
    expect(p.situazione_generale).toBe("Alta pressione sul Nord Italia");
    expect(p.scadenze).toHaveLength(1);
    expect(p.scadenze[0].id).toBe("1");
    expect(p.scadenze[0].giorno).toBe("oggi");
    expect(p.scadenze[0].zone).toHaveLength(1);
    expect(p.scadenze[0].zone[0].nome).toBe("REGIONE");
    expect(p.scadenze[0].zone[0].descrizione).toBe("Tutto il FVG");
    expect(p.scadenze[0].zone[0].attendibilita_perc).toBe("90");
    expect(p.scadenze[0].zone[0].mattina_simbolo).toBe("1");
    expect(p.scadenze[0].zone[0].mattina_descrizione).toBe("Sereno");
    expect(p.scadenze[0].zone[0].pomeriggio_simbolo).toBe("2");
    expect(p.scadenze[0].zone[0].sera_descrizione).toBe("Coperto");
  });
});

describe("parseWfsStazioni (ARPA FVG)", () => {
  it("parses active stations with sensor flags", () => {
    const xml = `<?xml version="1.0"?>
      <wfs:FeatureCollection>
        <wfs:member>
          <MONIT_AMB:STAZIONI_METEOROLOGICHE>
            <MONIT_AMB:CODICE_FVG>G201</MONIT_AMB:CODICE_FVG>
            <MONIT_AMB:DENOMINAZIONE>Adegliacco</MONIT_AMB:DENOMINAZIONE>
            <MONIT_AMB:ATTIVA>S</MONIT_AMB:ATTIVA>
            <MONIT_AMB:SOSPENSIONE_OSSERVAZIONE>N</MONIT_AMB:SOSPENSIONE_OSSERVAZIONE>
            <MONIT_AMB:TERMOMETRO>S</MONIT_AMB:TERMOMETRO>
            <MONIT_AMB:PLUVIOMETRO>S</MONIT_AMB:PLUVIOMETRO>
            <MONIT_AMB:ANEMOMETRO>N</MONIT_AMB:ANEMOMETRO>
            <gml:pos>5149191.718375 357337.373125</gml:pos>
          </MONIT_AMB:STAZIONI_METEOROLOGICHE>
        </wfs:member>
        <wfs:member>
          <MONIT_AMB:STAZIONI_METEOROLOGICHE>
            <MONIT_AMB:CODICE_FVG>C551</MONIT_AMB:CODICE_FVG>
            <MONIT_AMB:DENOMINAZIONE>Cividale</MONIT_AMB:DENOMINAZIONE>
            <MONIT_AMB:ATTIVA>S</MONIT_AMB:ATTIVA>
            <MONIT_AMB:SOSPENSIONE_OSSERVAZIONE>N</MONIT_AMB:SOSPENSIONE_OSSERVAZIONE>
            <MONIT_AMB:TERMOMETRO>S</MONIT_AMB:TERMOMETRO>
            <MONIT_AMB:PLUVIOMETRO>S</MONIT_AMB:PLUVIOMETRO>
            <MONIT_AMB:ANEMOMETRO>S</MONIT_AMB:ANEMOMETRO>
            <MONIT_AMB:IGROMETRO>S</MONIT_AMB:IGROMETRO>
            <gml:pos>5000000.0 350000.0</gml:pos>
          </MONIT_AMB:STAZIONI_METEOROLOGICHE>
        </wfs:member>
      </wfs:FeatureCollection>`;
    const stations = parseWfsStazioni(xml);
    expect(stations).toHaveLength(2);
    expect(stations[0].codice).toBe("G201");
    expect(stations[0].nome).toBe("Adegliacco");
    expect(stations[0].sensori).toContain("temperatura");
    expect(stations[0].sensori).toContain("pioggia");
    expect(stations[0].sensori).not.toContain("vento");
    expect(stations[1].codice).toBe("C551");
    expect(stations[1].sensori).toContain("vento");
    expect(stations[1].sensori).toContain("umidita");
  });

  it("skips inactive or sospese stations", () => {
    const xml = `<?xml version="1.0"?>
      <wfs:FeatureCollection>
        <wfs:member>
          <MONIT_AMB:STAZIONI_METEOROLOGICHE>
            <MONIT_AMB:CODICE_FVG>G001</MONIT_AMB:CODICE_FVG>
            <MONIT_AMB:DENOMINAZIONE>Inattiva</MONIT_AMB:DENOMINAZIONE>
            <MONIT_AMB:ATTIVA>N</MONIT_AMB:ATTIVA>
            <MONIT_AMB:SOSPENSIONE_OSSERVAZIONE>N</MONIT_AMB:SOSPENSIONE_OSSERVAZIONE>
            <gml:pos>5140000.0 357000.0</gml:pos>
          </MONIT_AMB:STAZIONI_METEOROLOGICHE>
        </wfs:member>
        <wfs:member>
          <MONIT_AMB:STAZIONI_METEOROLOGICHE>
            <MONIT_AMB:CODICE_FVG>G002</MONIT_AMB:CODICE_FVG>
            <MONIT_AMB:DENOMINAZIONE>Sospesa</MONIT_AMB:DENOMINAZIONE>
            <MONIT_AMB:ATTIVA>S</MONIT_AMB:ATTIVA>
            <MONIT_AMB:SOSPENSIONE_OSSERVAZIONE>S</MONIT_AMB:SOSPENSIONE_OSSERVAZIONE>
            <gml:pos>5140000.0 358000.0</gml:pos>
          </MONIT_AMB:STAZIONI_METEOROLOGICHE>
        </wfs:member>
        <wfs:member>
          <MONIT_AMB:STAZIONI_METEOROLOGICHE>
            <MONIT_AMB:CODICE_FVG>G003</MONIT_AMB:CODICE_FVG>
            <MONIT_AMB:DENOMINAZIONE>Attiva</MONIT_AMB:DENOMINAZIONE>
            <MONIT_AMB:ATTIVA>S</MONIT_AMB:ATTIVA>
            <MONIT_AMB:SOSPENSIONE_OSSERVAZIONE>N</MONIT_AMB:SOSPENSIONE_OSSERVAZIONE>
            <gml:pos>5140000.0 359000.0</gml:pos>
          </MONIT_AMB:STAZIONI_METEOROLOGICHE>
        </wfs:member>
      </wfs:FeatureCollection>`;
    expect(parseWfsStazioni(xml)).toHaveLength(1);
  });

  it("sets lat/lon to 0 (projected coords, no conversion)", () => {
    const xml = `<wfs:FeatureCollection>
      <wfs:member>
        <MONIT_AMB:STAZIONI_METEOROLOGICHE>
          <MONIT_AMB:CODICE_FVG>G201</MONIT_AMB:CODICE_FVG>
          <MONIT_AMB:DENOMINAZIONE>Test</MONIT_AMB:DENOMINAZIONE>
          <MONIT_AMB:ATTIVA>S</MONIT_AMB:ATTIVA>
          <MONIT_AMB:SOSPENSIONE_OSSERVAZIONE>N</MONIT_AMB:SOSPENSIONE_OSSERVAZIONE>
          <gml:pos>5149191.718375 357337.373125</gml:pos>
        </MONIT_AMB:STAZIONI_METEOROLOGICHE>
      </wfs:member>
    </wfs:FeatureCollection>`;
    const s = parseWfsStazioni(xml);
    expect(s[0].lat).toBe(0);
    expect(s[0].lon).toBe(0);
  });
});

describe("parseStazioneXml (ARPA FVG)", () => {
  it("parses a station with all sensor fields", () => {
    const xml = `<meteo>
      <station_id>G201</station_id>
      <station_name>Adegliacco</station_name>
      <station_altitude>185</station_altitude>
      <observation_time>2026-07-21T12:00:00</observation_time>
      <meteo_data>
        <t unit="°C">24.5</t>
        <t_feel unit="°C">23.0</t_feel>
        <rr unit="mm">0.0</rr>
        <hu unit="%">65</hu>
        <pa unit="hPa">1013.2</pa>
        <ff unit="km/h">12.5</ff>
        <ff_max unit="km/h">18.3</ff_max>
        <dd>SO</dd>
        <cloudiness descrizione="poco nuvoloso">2</cloudiness>
        <to unit="°C">12.3</to>
        <gl unit="kJ/m2">1250</gl>
        <hs unit="cm">0</hs>
        <hns unit="cm">0</hns>
      </meteo_data>
    </meteo>`;
    const s = parseStazioneXml(xml) as any;
    expect(s.stazione).toBe("Adegliacco");
    expect(s.codice).toBe("G201");
    expect(s.temperatura_c).toBe(24.5);
    expect(s.temperatura_percepita).toBe(23.0);
    expect(s.precipitazioni_mm).toBe(0.0);
    expect(s.umidita_perc).toBe(65);
    expect(s.pressione_hPa).toBe(1013.2);
    expect(s.vento_kmh).toBe(12.5);
    expect(s.vento_raffica_kmh).toBe(18.3);
    expect(s.vento_direzione).toBe("SO");
    expect(s.nuvolosita).toBe("poco nuvoloso");
    expect(s.dew_point).toBe(12.3);
    expect(s.radiazione_kjm2).toBe(1250);
    expect(s.neve_cm).toBe(0);
    expect(s.neve_fresca_cm).toBe(0);
  });

  it("returns null when no meteo_data block", () => {
    const xml = `<meteo><station_id>G201</station_id></meteo>`;
    expect(parseStazioneXml(xml)).toBeNull();
  });
});
