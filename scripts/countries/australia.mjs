// Australia: RBA statistical tables (CSV) + ABS Data API (SDMX CSV). All official, key-less.
import { getText, csvObjects, parseCsv, isoDate } from "../lib/http.mjs";

const MON = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
const rbaDate = s => { const m = s.match(/^(\d\d)-(\w{3})-(\d{4})$/) || s.match(/^(\d\d)\/(\d\d)\/(\d{4})$/); return m ? `${m[3]}-${MON[m[2]] || m[2]}-${m[1]}` : null; };

// RBA statistical table column by Series ID -> [{date, value}] newest first (blank cells dropped).
async function rba(table, seriesId, limit = 400) {
  const rows = parseCsv(await getText(`https://www.rba.gov.au/statistics/tables/csv/${table}-data.csv`));
  const col = rows.find(r => r[0] === "Series ID").indexOf(seriesId);
  if (col < 0) throw new Error(`${seriesId} not in ${table}`);
  return rows.map(r => ({ date: rbaDate(r[0] || ""), value: parseFloat(r[col]) })).filter(o => o.date && Number.isFinite(o.value)).reverse().slice(0, limit);
}
// Daily values -> one value per completed calendar month (average), newest first.
function monthlyAvg(daily, today) {
  const by = {};
  for (const o of daily) (by[o.date.slice(0, 7)] ||= []).push(o.value);
  return Object.entries(by).filter(([m]) => m < today.slice(0, 7)).sort().reverse()
    .map(([m, v]) => ({ date: `${m}-01`, value: v.reduce((a, b) => a + b) / v.length }));
}
// Cash rate: one point per run of constant values (end date of each run), so "previous" is the prior level.
const runs = daily => daily.filter((o, i) => i === 0 || o.value !== daily[i - 1].value);

// ABS Data API (SDMX): newest-first observations for a dataflow + key.
async function abs(flow, key, n = 30) {
  const t = await getText(`https://data.api.abs.gov.au/rest/data/ABS,${flow}/${key}?lastNObservations=${n}&format=csvfilewithlabels`);
  return csvObjects(t).map(r => ({ date: isoDate(r.TIME_PERIOD), value: parseFloat(r.OBS_VALUE) })).filter(o => Number.isFinite(o.value)).sort((a, b) => (a.date < b.date ? 1 : -1));
}

// Monthly CPI (complete monthly CPI, dataflow CPI 2.0.0). Key = MEASURE.INDEX.TSEST.REGION.FREQ; measure 3 = % change from previous year.
const cpi = (id, index, tsest = 10) => ({ id, kind: "pct", freq: "m", decimals: 1, get: () => abs("CPI,2.0.0", `3.${index}.${tsest}.50.M`) });
const cpiUrl = "https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/consumer-price-index-australia/latest-release";

const RBA_DAILY = { kind: "pct", freq: "d", decimals: 2 };

export default {
  code: "australia",
  // https://www.rba.gov.au/schedules-events/board-meeting-schedules.html (2026: Nov 2-3, Dec 7-8; 2027: Feb 8-9, Mar 22-23). Decisions are announced 2:30 p.m. Sydney time.
  meetings: [
    { start: "2026-11-02", end: "2026-11-03", label: "Monday–Tuesday, November 2–3, 2026, together with a new Statement on Monetary Policy (the RBA’s full forecast, published four times a year)",
      decision_label: "Tuesday, Nov 3, 2:30 p.m. Australian Eastern Daylight Time (Sydney), when the RBA publishes its statement. That is 03:30 GMT on Nov 3, or 10:30 p.m. U.S. Eastern Time on Monday, Nov 2. The Governor then holds a media conference." },
    { start: "2026-12-07", end: "2026-12-08", label: "Monday–Tuesday, December 7–8, 2026",
      decision_label: "Tuesday, Dec 8, 2:30 p.m. Australian Eastern Daylight Time (Sydney), when the RBA publishes its statement. That is 03:30 GMT on Dec 8, or 10:30 p.m. U.S. Eastern Time on Monday, Dec 7. The Governor then holds a media conference." },
    { start: "2027-02-08", end: "2027-02-09", label: "Monday–Tuesday, February 8–9, 2027, together with a new Statement on Monetary Policy (the RBA’s full forecast, published four times a year)",
      decision_label: "Tuesday, Feb 9, 2:30 p.m. Australian Eastern Daylight Time (Sydney), when the RBA publishes its statement. That is 03:30 GMT on Feb 9, or 10:30 p.m. U.S. Eastern Time on Monday, Feb 8. The Governor then holds a media conference." },
    { start: "2027-03-22", end: "2027-03-23", label: "Monday–Tuesday, March 22–23, 2027",
      decision_label: "Tuesday, Mar 23, 2:30 p.m. Australian Eastern Daylight Time (Sydney), when the RBA publishes its statement. That is 03:30 GMT on Mar 23, or 11:30 p.m. U.S. Eastern Time on Monday, Mar 22. The Governor then holds a media conference." },
  ],
  calendar_url: "https://www.rba.gov.au/schedules-events/board-meeting-schedules.html",
  calendar_label: "Official RBA meeting schedule",

  // The RBA has no separate minutes feed; media releases (decisions) + speeches + SMP are the official RSS feeds (rba.gov.au/rss/).
  feeds: [
    { id: "decisions", url: "https://www.rba.gov.au/rss/rss-cb-media-releases.xml" },
    { id: "speeches", url: "https://www.rba.gov.au/rss/rss-cb-speeches.xml" },
    { id: "bulletin", url: "https://www.rba.gov.au/rss/rss-cb-bulletin.xml" },
  ],
  allowed_domains: ["rba.gov.au", "abs.gov.au", "aofm.gov.au", "treasury.gov.au", "data.api.abs.gov.au"],

  indicators: [
    // --- rates (RBA F1 / F2 / F11.1) ---
    { id: "rba_cash_rate_target", ...RBA_DAILY, get: async () => runs(await rba("f1", "FIRMMCRTD", 6000)) },
    { id: "10_year_government_bond_rate", ...RBA_DAILY, get: () => rba("f2", "FCMYGBAG10D", 60) },
    { id: "2_year_government_bond_rate", ...RBA_DAILY, get: () => rba("f2", "FCMYGBAG2D", 60) },
    { id: "10_year_bond_rate_monthly_average", kind: "pct", freq: "m", decimals: 2, get: async ({ today }) => monthlyAvg(await rba("f2", "FCMYGBAG10D", 700), today) },
    { id: "3_month_bank_bill_rate", kind: "pct", freq: "m", decimals: 2, get: async ({ today }) => monthlyAvg(await rba("f1", "FIRMMBAB90D", 700), today) },
    { id: "australian_dollar", kind: "level", freq: "d", decimals: 4, prefix: "US$", note: "AUD/USD only (the snapshot also quotes the trade-weighted index)", get: () => rba("f11.1", "FXRUSD", 60) },

    // --- prices (ABS monthly CPI, year-ended) ---
    cpi("consumer_price_index_cpi_all_items", 10001),
    // trimmed mean is only published seasonally adjusted (TSEST 20)
    cpi("trimmed_mean_inflation_monthly", 999902, 20),
    cpi("cpi_excluding_volatile_items_and_holid", 999904),
    cpi("automotive_fuel_prices", 40081),
    cpi("electricity_prices", 40055),
    cpi("rents", 115522),

    // --- jobs (ABS Labour Force, seasonally adjusted, persons, all ages, Australia). Key = MEASURE.SEX.AGE.TSEST.REGION.FREQ ---
    { id: "unemployment_rate", kind: "pct", freq: "m", decimals: 1, get: () => abs("LF", "M13.3.1599.20.AUS.M", 14) },
    { id: "employment_change", kind: "chg_k", freq: "m", get: () => abs("LF", "M3.3.1599.20.AUS.M", 14) },
    { id: "participation_rate", kind: "pct", freq: "m", decimals: 1, get: () => abs("LF", "M12.3.1599.20.AUS.M", 14) },
    { id: "employment_to_population_ratio", kind: "pct", freq: "m", decimals: 1, get: () => abs("LF", "M16.3.1599.20.AUS.M", 14) },
    { id: "underemployment_rate", kind: "pct", freq: "m", decimals: 1, get: () => abs("LF_UNDER", "M23.3.1599.20.AUS.M", 14) },
    // WPI: ordinary time hourly rates excl. bonuses, private+public, all industries, original, year-ended
    { id: "wage_price_index", kind: "pct", freq: "q", decimals: 1, get: () => abs("WPI", "3.OHRPEB.7.TOT.10.AUS.Q", 10) },

    // --- activity (ABS National Accounts / Household Spending Indicator), SA ---
    { id: "real_gdp_growth", kind: "pct", freq: "q", decimals: 1, note: "quarterly growth shown; year-ended is 4 quarters back", get: () => abs("ANA_AGG", "M2.GPM.20.AUS.Q", 10) },
    { id: "household_consumption", kind: "pct", freq: "q", decimals: 1, get: () => abs("ANA_EXP", "PCT_VCH.FCE.PHS.20.AUS.Q", 10) },
    { id: "household_saving_ratio", kind: "pct", freq: "q", decimals: 1, get: () => abs("ANA_AGG", "M7.HSR.20.AUS.Q", 10) },
    { id: "terms_of_trade", kind: "pct", freq: "q", decimals: 1, get: () => abs("ANA_AGG", "M6.TTR.20.AUS.Q", 10) },
    { id: "household_spending_indicator", kind: "pct", freq: "m", decimals: 1, note: "year-ended, current prices", get: () => abs("HSI_M", "9.TOT.CUR.20.AUS.M", 14) },

    // --- global (FRED; untested: needs FRED key) ---
    { id: "oil_price_brent", kind: "usd", freq: "d", decimals: 2, unit: "a barrel", tag: "secondary", get: ({ fred }) => fred("DCOILBRENTEU") }, // untested: needs FRED key
  ],

  kpis: [
    { id: "rba_cash_rate_target", label: "RBA cash rate" },
    { id: "consumer_price_index_cpi_all_items", label: "Price rise, past year", note: "Target band 2–3%" },
    { id: "unemployment_rate", label: "Unemployment" },
    { id: "10_year_government_bond_rate", label: "10-year bond rate" },
  ],
  overview: {
    rate: { id: "rba_cash_rate_target" },
    prices: { id: "consumer_price_index_cpi_all_items", label: "CPI" },
    jobless: { id: "unemployment_rate", label: "Unemployment" },
    tenyr: { id: "10_year_government_bond_rate", label: "10-yr" },
  },

  // Dates from https://www.abs.gov.au/release-calendar/future-releases (checked 2026-10-14, all 11:30 a.m. AEDT)
  // and the RBA release schedule https://www.rba.gov.au/schedules-events/ (minutes two weeks after each meeting: Nov 17, Dec 22).
  releases: [
    ["labour_force", "Labour Force, September", "ABS", "2026-10-15", "Thu Oct 15", "202610", "Jobs gained or lost, and the unemployment rate."],
    ["consumer_price_index", "Consumer Price Index, September and September quarter", "ABS", "2026-10-28", "Wed Oct 28", "202610", "How much the prices families pay changed, for the month and the whole quarter, including the trimmed mean."],
    ["international_trade_price_inde", "International Trade Price Indexes, Sep quarter", "ABS", "2026-10-29", "Thu Oct 29", "202610", "Prices of goods Australia imports and exports."],
    ["producer_price_indexes", "Producer Price Indexes, Sep quarter", "ABS", "2026-10-30", "Fri Oct 30", "202610", "What businesses pay and charge each other."],
    ["building_approvals", "Building Approvals", "ABS", "2026-11-02", "Mon Nov 2", "202611", "How many new homes councils approved."],
    ["household_spending_indicator", "Household Spending Indicator, September", "ABS", "2026-11-04", "Wed Nov 4", "202611", "How much households spent in the month."],
    ["lending_indicators", "Lending Indicators, Sep quarter", "ABS", "2026-11-11", "Wed Nov 11", "202611", "New home loans and business loans."],
    ["minutes_of_the_nov_2_3_meeting", "Minutes of the Nov 2–3 meeting", "RBA", "2026-11-17", "Tue Nov 17", "rba", "Notes on what members discussed."],
    ["wage_price_index", "Wage Price Index, Sep quarter", "ABS", "2026-11-18", "Wed Nov 18", "202611", "How fast pay rates are rising."],
    ["labour_force_2", "Labour Force, October", "ABS", "2026-11-19", "Thu Nov 19", "202611", "Jobs and the unemployment rate."],
    ["consumer_price_index_2", "Consumer Price Index, October", "ABS", "2026-11-25", "Wed Nov 25", "202611", "Prices families pay, for October."],
    ["household_spending_indicator_2", "Household Spending Indicator, October", "ABS", "2026-11-30", "Mon Nov 30", "202611", "How much households spent in October."],
    ["national_accounts_gdp", "National Accounts (GDP), Sep quarter", "ABS", "2026-12-02", "Wed Dec 2", "202612", "How fast the whole economy grew over winter."],
    ["labour_force_3", "Labour Force, November", "ABS", "2026-12-17", "Thu Dec 17", "202612", "Jobs and the unemployment rate."],
    ["minutes_of_the_dec_7_8_meeting", "Minutes of the Dec 7–8 meeting", "RBA", "2026-12-22", "Tue Dec 22", "rba", "Notes on what members discussed."],
    ["consumer_price_index_3", "Consumer Price Index, November", "ABS", "2027-01-06", "Wed Jan 6", "202701", "Prices families pay, for November."],
  ].map(([id, name, publisher, date, date_label, cal, what]) => ({
    id, name, publisher, date, date_label, what, weekly: false,
    time: "11:30 a.m.",
    url: cal === "rba" ? "https://www.rba.gov.au/schedules-events/" : `https://www.abs.gov.au/release-calendar/future-releases/${cal}`,
  })),
};
