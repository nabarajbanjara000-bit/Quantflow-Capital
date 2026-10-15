// Germany / euro area. The ECB sets the rate; national data from Destatis, Bundesbank, Bundesagentur für Arbeit, Eurostat.
import { getText, getJson, csvObjects, isoDate } from "../lib/http.mjs";

const UA = { headers: { "User-Agent": "Mozilla/5.0 (QuantFlow-CentralBankMonitor)" } };
const ago = (today, years) => `${+today.slice(0, 4) - years}${today.slice(4)}`;

// ECB Data Portal (SDMX csvdata, no key). `flow/key` like "EXR/D.USD.EUR.SP00.A".
const ecb = (path, n = 30) => async () =>
  csvObjects(await getText(`https://data-api.ecb.europa.eu/service/data/${path}?lastNObservations=${n}&format=csvdata`))
    .map(r => ({ date: isoDate(r.TIME_PERIOD), value: +r.OBS_VALUE })).reverse();

// Eurostat dissemination API (JSON-stat). Every filter must leave one value per period (geo/unit/... all single).
const estat = (dataset, filters, n = 30) => async () => {
  const q = new URLSearchParams({ format: "JSON", ...filters, lastTimePeriod: String(n) });
  const j = await getJson(`https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${dataset}?${q}`, UA);
  const times = Object.entries(j.dimension.time.category.index);
  return times.filter(([, i]) => j.value[i] != null).map(([t, i]) => ({ date: isoDate(t), value: j.value[i] })).reverse();
};

// Bundesbank time-series REST API (semicolon CSV, decimal comma). `path` like "BBSIS/D.I.ZST...".
const bbk = (path, years = 3) => async ({ today }) => {
  const t = await getText(`https://api.statistiken.bundesbank.de/rest/data/${path}?startPeriod=${ago(today, years)}&format=csv`);
  return t.split(/\r?\n/).map(l => l.split(";")).filter(c => /^\d{4}-\d{2}(-\d{2})?$/.test(c[0]) && /^-?[\d,.]+$/.test(c[1]))
    .map(c => ({ date: isoDate(c[0]), value: +c[1].replace(",", ".") })).reverse();
};

const HICP = (coicop18, geo = "EA21") => estat("prc_hicp_minr", { geo, coicop18, unit: "RCH_A" });
const BUND = k => `BBSIS/D.I.ZST.ZI.EUR.S1311.B.A604.${k}.R.A.A._Z._Z.A`;
const CPI = k => `BBDP1/M.DE.N.VPI.C.${k}.I20.A`;
const yld = { kind: "level", freq: "d", decimals: 2, suffix: "%" };
const fredUsd = (id, freq, unit) => ({ kind: "usd", freq, decimals: 2, unit, get: ({ fred }) => fred(id, { limit: 30 }) }); // untested: needs FRED key

const eurostatUrl = "https://ec.europa.eu/eurostat/news/release-calendar";
const destatisUrl = "https://www.destatis.de/SiteGlobals/Forms/Suche/Termine/EN/Terminsuche_Formular.html";
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MO = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const rel = (id, name, publisher, date, url, what, time = "") => {
  const t = new Date(date + "T00:00:00Z");
  return { id, name, publisher, date, date_label: `${WD[t.getUTCDay()]} ${MO[t.getUTCMonth()]} ${t.getUTCDate()}`, time, url, what, weekly: false };
};
const ES = (id, name, date, what) => rel(id, name, "Eurostat", date, eurostatUrl, what); // dates: Eurostat release calendar (euro indicators), read 2026-10-14

const dec = "Thursday, Oct 29, 2:15 p.m. Central European Time (when the ECB publishes its decision), followed by President Lagarde's press conference";
const dl = d => `Thursday, ${d}, 2:15 p.m. Central European Time (when the ECB publishes its decision), followed by President Lagarde's press conference`;

export default {
  code: "germany",
  // ECB Governing Council monetary-policy meetings, from https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html (read 2026-10-14)
  meetings: [
    { start: "2026-10-28", end: "2026-10-29", label: "Wednesday–Thursday, October 28–29, 2026, in Frankfurt", decision_label: dec },
    { start: "2026-12-16", end: "2026-12-17", label: "Wednesday–Thursday, December 16–17, 2026, in Frankfurt", decision_label: dl("Dec 17") },
    { start: "2027-02-03", end: "2027-02-04", label: "Wednesday–Thursday, February 3–4, 2027, in Frankfurt", decision_label: dl("Feb 4") },
    { start: "2027-03-17", end: "2027-03-18", label: "Wednesday–Thursday, March 17–18, 2027, in Frankfurt", decision_label: dl("Mar 18") },
  ],
  calendar_url: "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html",
  calendar_label: "Official ECB meeting calendar",
  // One ECB feed carries press releases, accounts of the meeting, speeches and interviews (https://www.ecb.europa.eu/rss/press.html); ECB has no separate accounts.xml/speeches.xml (404).
  feeds: [{ id: "press", url: "https://www.ecb.europa.eu/rss/press.xml" }],
  allowed_domains: ["ecb.europa.eu", "europa.eu", "ec.europa.eu", "destatis.de", "bundesbank.de", "arbeitsagentur.de", "statistik.arbeitsagentur.de", "ifo.de", "bundesregierung.de"],

  indicators: [
    // ECB policy rates (daily series, so the date stays current)
    { id: "ecb_deposit_facility_rate_the_main_pol", kind: "pct", freq: "d", decimals: 2, get: ecb("FM/D.U2.EUR.4F.KR.DFR.LEV", 5) },
    { id: "ecb_main_refinancing_rate", kind: "pct", freq: "d", decimals: 2, get: ecb("FM/D.U2.EUR.4F.KR.MRR_FR.LEV", 5) },
    // Euro-area HICP, annual rate (Eurostat, ECOICOP ver. 2 dataset prc_hicp_minr; includes the flash estimate)
    { id: "euro_area_inflation_hicp_the_ecb_s_tar", kind: "pct", freq: "m", decimals: 1, get: HICP("TOTAL") },
    { id: "euro_area_core_inflation_without_energ", kind: "pct", freq: "m", decimals: 1, get: HICP("TOT_X_NRG_FOOD") },
    { id: "euro_area_energy_prices", kind: "pct", freq: "m", decimals: 1, get: HICP("NRG") },
    { id: "euro_area_services_prices", kind: "pct", freq: "m", decimals: 1, get: HICP("SERV") },
    // German national CPI index (Destatis data via the Bundesbank API), index levels -> yoy/mom computed here
    { id: "german_consumer_prices_cpi", kind: "yoy_mom", freq: "m", decimals: 1, get: bbk(CPI("A00000")) },
    { id: "german_energy_prices", kind: "yoy_mom", freq: "m", decimals: 1, get: bbk(CPI("NRGY00")) },
    // Labour market (ILO definition, seasonally adjusted)
    { id: "euro_area_unemployment_rate", kind: "pct", freq: "m", decimals: 1, get: estat("une_rt_m", { geo: "EA21", s_adj: "SA", age: "TOTAL", unit: "PC_ACT", sex: "T" }) },
    { id: "german_unemployment_rate_eu_standard_i", kind: "pct", freq: "m", decimals: 1, get: estat("une_rt_m", { geo: "DE", s_adj: "SA", age: "TOTAL", unit: "PC_ACT", sex: "T" }) },
    // GDP, change on the previous quarter, chain-linked, seasonally and calendar adjusted
    { id: "german_gdp_growth", kind: "pct", freq: "q", decimals: 1, get: estat("namq_10_gdp", { geo: "DE", s_adj: "SCA", unit: "CLV_PCH_PRE", na_item: "B1GQ" }) },
    { id: "euro_area_gdp_growth", kind: "pct", freq: "q", decimals: 1, get: estat("namq_10_gdp", { geo: "EA21", s_adj: "SCA", unit: "CLV_PCH_PRE", na_item: "B1GQ" }) },
    // Bundesbank yield curve of listed federal securities (daily)
    { id: "2_year_german_government_bond_schatz", ...yld, get: bbk(BUND("R02XX"), 1) },
    { id: "10_year_german_government_bond_bund", ...yld, get: bbk(BUND("R10XX"), 1) },
    { id: "30_year_german_government_bond", ...yld, get: bbk(BUND("R30XX"), 1) },
    // ECB euro foreign-exchange reference rate
    { id: "euro_vs_u_s_dollar", kind: "level", freq: "d", decimals: 4, prefix: "$", suffix: " per euro", get: ecb("EXR/D.USD.EUR.SP00.A", 10) },
    // Oil and gas via FRED (EIA / IMF series)
    { id: "oil_price_brent_crude_european_benchma", ...fredUsd("DCOILBRENTEU", "d", "a barrel") },
    { id: "oil_price_wti_crude_u_s", ...fredUsd("DCOILWTICO", "d", "a barrel") },
    { id: "natural_gas_price_europe", ...fredUsd("PNGASEUUSDM", "m", "per million BTU") },
  ],

  kpis: [
    { id: "ecb_deposit_facility_rate_the_main_pol", label: "ECB interest rate", note: "Deposit rate" },
    { id: "euro_area_inflation_hicp_the_ecb_s_tar", label: "Price rise, past year (euro area)", note: "Goal is 2%" },
    { id: "german_registered_unemployment_nationa", label: "Unemployment (Germany)", note: "National count" },
    { id: "10_year_german_government_bond_bund", label: "10-year Bund rate" },
  ],
  overview: {
    rate: { id: "ecb_deposit_facility_rate_the_main_pol" },
    prices: { id: "euro_area_inflation_hicp_the_ecb_s_tar", label: "Euro-area HICP" },
    jobless: { id: "german_registered_unemployment_nationa", label: "Germany" },
    tenyr: { id: "10_year_german_government_bond_bund", label: "Bund" },
  },

  // Dates: Eurostat release calendar (euro indicators), Destatis release calendar, Bundesagentur press page (monthly press conference 10:00 a.m., Nürnberg). Read 2026-10-14.
  releases: [
    ES("euro_area_inflation_hicp", "Euro-area inflation (HICP), September final · Eurostat", "2026-10-16", "The final, detailed version of September's price rise, by category and country."),
    rel("german_producer_prices", "German producer prices (industry), September · Destatis", "Destatis", "2026-10-20", destatisUrl, "What German factories charge for their products."),
    ES("euro_area_sentiment", "Euro-area economic sentiment, October · Eurostat", "2026-10-29", "A European Commission survey of how firms and households see the economy."),
    ES("euro_area_and_german_gdp_q3_fi", "Euro-area GDP, Q3 first estimate · Eurostat", "2026-10-30", "How fast the euro-area economy grew in July–September."),
    rel("german_consumer_prices_cpi_oct", "German consumer prices (CPI), October flash · Destatis", "Destatis", "2026-10-30", destatisUrl, "Germany's first estimate of October prices."),
    ES("euro_area_unemployment", "Euro-area unemployment, September · Eurostat", "2026-10-30", "The share of people without a job in the euro area and each country."),
    rel("german_labour_market", "German labour market, October", "Bundesagentur für Arbeit", "2026-10-30", "https://www.arbeitsagentur.de/en/press", "Registered unemployment and job vacancies in Germany.", "10:00 a.m. CET"),
    ES("euro_area_inflation_hicp_octob", "Euro-area inflation (HICP), October flash · Eurostat", "2026-11-04", "The first estimate of October prices for the euro area."),
    ES("euro_area_gdp_q3_flash", "Euro-area GDP and employment, Q3 flash · Eurostat", "2026-11-13", "A fuller estimate of July–September growth, with employment."),
    ES("euro_area_inflation_hicp_oct_final", "Euro-area inflation (HICP), October final · Eurostat", "2026-11-18", "The final, detailed version of October's price rise."),
    rel("german_labour_market_2", "German labour market, November", "Bundesagentur für Arbeit", "2026-11-27", "https://www.arbeitsagentur.de/en/press", "Registered unemployment in Germany.", "10:00 a.m. CET"),
    ES("euro_area_inflation_hicp_nov_flash", "Euro-area inflation (HICP), November flash · Eurostat", "2026-12-01", "The first estimate of November prices for the euro area."),
    ES("euro_area_unemployment_2", "Euro-area unemployment, October · Eurostat", "2026-12-02", "The share of people without a job in the euro area and each country."),
    ES("euro_area_gdp_q3_update", "Euro-area GDP and employment, Q3 update · Eurostat", "2026-12-07", "The full breakdown of July–September growth."),
  ],
};
