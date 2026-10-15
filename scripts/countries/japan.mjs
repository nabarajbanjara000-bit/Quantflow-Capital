// Japan: Bank of Japan (BoJ). Sources: BoJ Time-Series Data Search API, Statistics Bureau CSV, MoF JGB CSV, Cabinet Office (ESRI) GDP CSV.
// All feeds below are official and key-less; the three FRED lines are marked untested.
const BOJ = "https://www.stat-search.boj.or.jp/api/v1/getDataCode?format=json&lang=en";
const MOF = "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/";
const ESRI = "https://www.esri.cao.go.jp";
const SB = "https://www.stat.go.jp/data/cpi/2025/csv/";

// Shift-JIS CSVs: getText decodes as UTF-8, so Japanese text is garbled but numbers and ASCII headers/codes survive.
const iso = (y, m, d = 1) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// BoJ API: [{date, value}] newest first. Dates: YYYYMMDD (daily), YYYYMM (monthly), YYYYQQ (Tankan quarterly, QQ = 01..04).
const boj = (db, code, start, freq = "m") => async ({ getJson }) => {
  const r = (await getJson(`${BOJ}&db=${db}&code=${encodeURIComponent(code)}&startDate=${start}`)).RESULTSET[0].VALUES;
  return r.SURVEY_DATES.map((s, i) => {
    s = String(s);
    const date = freq === "d" ? iso(s.slice(0, 4), s.slice(4, 6), s.slice(6, 8)) : freq === "q" ? iso(s.slice(0, 4), (+s.slice(4) - 1) * 3 + 1) : iso(s.slice(0, 4), s.slice(4, 6));
    return { date, value: r.VALUES[i] };
  }).filter(o => o.value != null).reverse();
};

// Statistics Bureau CPI index CSV (2025 base, Jan 2025 onward) -> year-on-year % series (the CSV has no seasonal adjustment, so no month change is shown).
const cpiYoy = (file, code) => async ({ getText, parseCsv }) => {
  const rows = parseCsv(await getText(SB + file));
  const col = rows[2].indexOf(code);
  const idx = Object.fromEntries(rows.filter(r => /^\d{6}$/.test(r[0]) && r[col]).map(r => [r[0], +r[col]]));
  return Object.keys(idx).sort().reverse().map(m => {
    const prev = idx[`${+m.slice(0, 4) - 1}${m.slice(4)}`];
    return prev && { date: iso(m.slice(0, 4), m.slice(4)), value: (idx[m] / prev - 1) * 100 };
  }).filter(Boolean);
};

// MoF JGB yields: current month file (+ full history when the month is young). Returns [{date, value}] newest first for one maturity column.
async function jgbRows({ getText, parseCsv }, hist) {
  const rows = parseCsv(await getText(MOF + (hist ? "historical/jgbcme_all.csv" : "jgbcme.csv")));
  const h = rows.find(r => r[0] === "Date");
  return { h, data: rows.filter(r => /^\d{4}\/\d+\/\d+$/.test(r[0])) };
}
const jgb = tenor => async ctx => {
  let { h, data } = await jgbRows(ctx);
  if (data.length < 3) ({ h, data } = await jgbRows(ctx, true));
  const c = h.indexOf(tenor);
  return data.map(r => { const [y, m, d] = r[0].split("/"); return { date: iso(y, m, d), value: parseFloat(r[c]) }; }).filter(o => Number.isFinite(o.value)).reverse();
};
// Calendar-month average of the daily 10Y yield (complete months only).
const jgbMonthly = tenor => async ctx => {
  const { h, data } = await jgbRows(ctx, true);
  const c = h.indexOf(tenor), by = {};
  for (const r of data) { const [y, m] = r[0].split("/"), v = parseFloat(r[c]); if (Number.isFinite(v)) (by[iso(y, m)] ||= []).push(v); }
  return Object.keys(by).filter(k => k < ctx.today.slice(0, 7) + "-01").sort().reverse().slice(0, 36).map(k => ({ date: k, value: by[k].reduce((a, b) => a + b) / by[k].length }));
};

// Cabinet Office GDP: latest release's "Real, seasonally adjusted, quarter-on-quarter %" table (ritu-jk) or contributions (kiyo-jk); `col` is the column.
const gdp = (table, col) => async ({ getText, parseCsv }) => {
  const top = await getText(`${ESRI}/jp/sna/sokuhou/sokuhou_top.html`);
  const page = top.match(/\/jp\/sna\/data\/data_list\/sokuhou\/files\/\d{4}\/qe\w+\/gdemenuja\.html/)[0];
  const menu = await getText(ESRI + page);
  const file = menu.match(new RegExp(`tables/${table}\\d+\\.csv`))[0];
  const rows = parseCsv(await getText(ESRI + page.replace("gdemenuja.html", file)));
  let year, out = [];
  for (const r of rows) {
    const m = r[0].trim().match(/^(?:(\d{4})\/)?\s*(\d+)-\s*\d+\.$/);
    if (!m) continue;
    year = m[1] || year;
    const v = parseFloat(r[col]);
    if (Number.isFinite(v)) out.push({ date: iso(year, m[2]), value: v });
  }
  return out.reverse();
};

// BoJ policy rate = Basic Loan Rate - 0.25 (relationship holds since Jan 2025: 0.75->0.50 ... 1.50->1.25). ponytail: breaks if the BoJ changes that spread.
const policyRate = async ctx => (await boj("IR01", "MADR1Z@D", "202501", "d")(ctx)).filter(o => o.date >= "2025-01-24").slice(0, 120).map(o => ({ date: o.date, value: o.value - 0.25 }));

const TK = (code, extra = {}) => ({ kind: "level", freq: "q", decimals: 0, get: boj("CO", code, "202301", "q"), ...extra });
const PR = (id, code, extra = {}) => ({ id, kind: "yoy_mom", freq: "m", decimals: 1, get: boj("PR01", code, "202401"), ...extra });

export default {
  code: "japan",

  // Source: https://www.boj.or.jp/en/mopo/mpmsche_minu/index.htm (BoJ monetary policy meeting schedule, 2026 and 2027 tables).
  meetings: [
    { start: "2026-10-29", end: "2026-10-30", label: "Thursday–Friday, October 29–30, 2026 (a meeting that also publishes new forecasts, the “Outlook Report”)", decision_label: "Friday, Oct 30. The BoJ does not fix the time in advance; in 2026 its statements came out between 11:46 a.m. and 12:19 p.m. Japan time (JST)." },
    { start: "2026-12-17", end: "2026-12-18", label: "Thursday–Friday, December 17–18, 2026", decision_label: "Friday, Dec 18. The BoJ does not fix the time in advance; in 2026 its statements came out between 11:46 a.m. and 12:19 p.m. Japan time (JST)." },
    { start: "2027-01-21", end: "2027-01-22", label: "Thursday–Friday, January 21–22, 2027 (a meeting that also publishes new forecasts, the “Outlook Report”)", decision_label: "Friday, Jan 22. The BoJ does not fix the time in advance." },
    { start: "2027-03-17", end: "2027-03-18", label: "Wednesday–Thursday, March 17–18, 2027", decision_label: "Thursday, Mar 18. The BoJ does not fix the time in advance." },
  ],
  calendar_url: "https://www.boj.or.jp/en/mopo/mpmsche_minu/index.htm",
  calendar_label: "Official BoJ meeting schedule",

  // The BoJ publishes ONE English RSS feed ("What's New", 50+ items: statements, minutes, summaries, speeches, statistics). No separate decisions/speeches feeds exist (checked rss/mopo.xml, speech.xml etc.: 404).
  feeds: [{ id: "whatsnew", url: "https://www.boj.or.jp/en/rss/whatsnew.xml" }],

  allowed_domains: ["boj.or.jp", "stat-search.boj.or.jp", "stat.go.jp", "e-stat.go.jp", "mof.go.jp", "esri.cao.go.jp", "cao.go.jp", "mhlw.go.jp", "meti.go.jp"],

  indicators: [
    // --- Prices (Statistics Bureau, year-on-year computed from the official index CSV)
    { id: "consumer_price_index_cpi_all_items", kind: "pct", freq: "m", decimals: 1, get: cpiYoy("zmi2025aa.csv", "0001") },
    { id: "core_cpi_without_fresh_food", kind: "pct", freq: "m", decimals: 1, get: cpiYoy("zmi2025aa.csv", "0161") },
    { id: "cpi_without_fresh_food_and_energy", kind: "pct", freq: "m", decimals: 1, get: cpiYoy("zmi2025aa.csv", "0178") },
    { id: "cpi_energy", kind: "pct", freq: "m", decimals: 1, get: cpiYoy("zmi2025aa.csv", "0167") },
    { id: "cpi_food_without_fresh_food", kind: "pct", freq: "m", decimals: 1, get: cpiYoy("zmi2025aa.csv", "0172") },
    { id: "tokyo_core_cpi_without_fresh_food", kind: "pct", freq: "m", decimals: 1, get: cpiYoy("tmi2025aa.csv", "0161") },
    { id: "tokyo_cpi_without_fresh_food_and_energ", kind: "pct", freq: "m", decimals: 1, get: cpiYoy("tmi2025aa.csv", "0178") },
    // --- Producer / import prices (BoJ Corporate Goods Price Index, 2020 base)
    PR("corporate_goods_price_index_business_p", "PRCG20_2200000000"),
    PR("import_prices_in_yen", "PRCG20_2600000000"),
    PR("import_prices_foreign_currency_terms", "PRCG20_2500000000"),
    PR("petroleum_and_coal_products_business_p", "PRCG20_2200620001"),
    // --- Jobs (no key-less official feed found for the Labour Force Survey: e-Stat needs an appId)
    // --- Growth (Cabinet Office, latest quarterly GDP release; real, seasonally adjusted)
    { id: "gdp_real_april_june", kind: "pct", freq: "q", decimals: 1, note: "Quarter-on-quarter, not annualised", get: gdp("ritu-jk", 1) },
    { id: "household_spending_in_gdp", kind: "pct", freq: "q", decimals: 1, note: "Private consumption, quarter-on-quarter", get: gdp("ritu-jk", 2) },
    { id: "business_investment_in_gdp", kind: "pct", freq: "q", decimals: 1, note: "Private non-residential investment, quarter-on-quarter", get: gdp("ritu-jk", 6) },
    { id: "net_exports_contribution_to_growth", kind: "level", freq: "q", decimals: 1, suffix: " points", get: gdp("kiyo-jk", 11) },
    // --- Tankan (BoJ; quarterly, dated by the first month of the quarter)
    { id: "tankan_large_manufacturers", ...TK("TK99F1000601GCQ01000") },
    { id: "tankan_large_non_manufacturers", ...TK("TK99F2000601GCQ01000") },
    { id: "tankan_employment_conditions_all_firms", ...TK("TK99F0000608GCQ00000") },
    // --- Rates and markets
    { id: "boj_policy_rate_overnight_call_rate_ta", kind: "pct", freq: "d", decimals: 2, note: "Derived: BoJ Basic Loan Rate minus 0.25 points", get: policyRate },
    { id: "overnight_call_rate_actual_monthly_ave", kind: "pct", freq: "m", decimals: 3, get: boj("FM02", "STRACLUCON", "202401") },
    { id: "2_year_government_bond_rate", kind: "pct", freq: "d", decimals: 2, get: jgb("2Y") },
    { id: "10_year_government_bond_rate", kind: "pct", freq: "d", decimals: 2, get: jgb("10Y") },
    { id: "30_year_government_bond_rate", kind: "pct", freq: "d", decimals: 2, get: jgb("30Y") },
    { id: "10_year_rate_monthly_average", kind: "pct", freq: "m", decimals: 2, note: "Average of daily Ministry of Finance 10Y yields", get: jgbMonthly("10Y") },
    { id: "yen_per_us_dollar", kind: "level", freq: "d", decimals: 2, prefix: "¥", get: boj("FM08", "FXERD05", "202609", "d") },
    // --- Oil (untested: needs FRED key)
    { id: "brent_crude_oil", kind: "usd", freq: "d", decimals: 2, unit: " a barrel", tag: "secondary", note: "EIA via FRED", get: ({ fred }) => fred("DCOILBRENTEU", { limit: 30 }) }, // untested: needs FRED key
    { id: "wti_crude_oil_us", kind: "usd", freq: "d", decimals: 2, unit: " a barrel", tag: "secondary", note: "EIA via FRED", get: ({ fred }) => fred("DCOILWTICO", { limit: 30 }) }, // untested: needs FRED key
  ],

  kpis: [
    { id: "boj_policy_rate_overnight_call_rate_ta", label: "BoJ interest rate" },
    { id: "core_cpi_without_fresh_food", label: "Price rise, past year" },
    { id: "unemployment_rate", label: "Unemployment" },
    { id: "10_year_government_bond_rate", label: "10-year bond rate" },
  ],
  overview: {
    rate: { id: "boj_policy_rate_overnight_call_rate_ta" },
    prices: { id: "core_cpi_without_fresh_food", label: "Core CPI" },
    jobless: { id: "unemployment_rate", label: "Unemployment" },
    tenyr: { id: "10_year_government_bond_rate", label: "10-year JGB yield" },
  },

  // Dates: BoJ release schedule https://www.boj.or.jp/en/about/calendar/index.htm (to Nov 5) and meeting table (later minutes/summaries);
  // Statistics Bureau https://www.stat.go.jp/english/data/cpi/1582.html and .../roudou/1543.html; Cabinet Office https://www.esri.cao.go.jp/jp/sna/kouhyou/kouhyou_top.html
  // Times for Statistics Bureau / Cabinet Office are those of the snapshot (the schedules list dates only). Not covered (no verified official date): Tankan December, CGPI, MHLW wage survey.
  releases: [
    { id: "speech_by_board_member_koeda_k", name: "Speech by Board member Koeda (Kumamoto)", publisher: "BoJ", date: "2026-10-15", date_label: "Thu Oct 15", time: "10:30 a.m. JST", url: "https://www.boj.or.jp/en/about/calendar/index.htm", what: "A Board member's views on the economy and policy.", weekly: false },
    { id: "national_cpi", name: "National CPI, September", publisher: "Statistics Bureau", date: "2026-10-23", date_label: "Fri Oct 23", time: "8:30 a.m. JST", url: "https://www.stat.go.jp/english/data/cpi/1582.html", what: "How much the prices households pay changed, across Japan.", weekly: false },
    { id: "services_producer_price_index", name: "Services Producer Price Index, September", publisher: "BoJ", date: "2026-10-27", date_label: "Tue Oct 27", time: "8:50 a.m. JST", url: "https://www.boj.or.jp/en/about/calendar/index.htm", what: "Prices that businesses charge each other for services, like transport and advertising.", weekly: false },
    { id: "indicators_for_core_cpi", name: "Indicators for core CPI", publisher: "BoJ", date: "2026-10-27", date_label: "Tue Oct 27", time: "2:00 p.m. JST", url: "https://www.boj.or.jp/en/about/calendar/index.htm", what: "BoJ measures of the underlying price trend that strip out unusual price moves.", weekly: false },
    { id: "tokyo_cpi", name: "Tokyo CPI, October", publisher: "Statistics Bureau", date: "2026-10-30", date_label: "Fri Oct 30", time: "8:30 a.m. JST", url: "https://www.stat.go.jp/english/data/cpi/1582.html", what: "Prices in Tokyo's 23 wards, published early as a preview of the nation.", weekly: false },
    { id: "labour_force_survey", name: "Labour Force Survey, September", publisher: "MHLW", date: "2026-10-30", date_label: "Fri Oct 30", time: "8:30 a.m. JST", url: "https://www.stat.go.jp/english/data/roudou/1543.html", what: "The unemployment rate and how many jobs are on offer per job seeker.", weekly: false },
    { id: "outlook_report", name: "Outlook Report, full text", publisher: "BoJ", date: "2026-11-02", date_label: "Mon Nov 2", time: "2:00 p.m. JST", url: "https://www.boj.or.jp/en/about/calendar/index.htm", what: "The detailed explanation behind the new forecasts.", weekly: false },
    { id: "minutes_of_the_september_meeti", name: "Minutes of the September meeting", publisher: "BoJ", date: "2026-11-05", date_label: "Thu Nov 5", time: "8:50 a.m. JST", url: "https://www.boj.or.jp/en/about/calendar/index.htm", what: "A fuller record of the September debate.", weekly: false },
    { id: "summary_of_opinions", name: "Summary of Opinions, October meeting", publisher: "BoJ", date: "2026-11-10", date_label: "Tue Nov 10", time: "8:50 a.m. JST", url: "https://www.boj.or.jp/en/mopo/mpmsche_minu/index.htm", what: "Unnamed comments from each Board member at the October meeting.", weekly: false },
    { id: "gdp_july_september", name: "GDP, July–September, first estimate", publisher: "Cabinet Office", date: "2026-11-16", date_label: "Mon Nov 16", time: "8:50 a.m. JST", url: "https://www.esri.cao.go.jp/jp/sna/kouhyou/kouhyou_top.html", what: "How much the whole economy grew or shrank in the quarter.", weekly: false },
    { id: "national_cpi_2", name: "National CPI, October", publisher: "Statistics Bureau", date: "2026-11-20", date_label: "Fri Nov 20", time: "8:30 a.m. JST", url: "https://www.stat.go.jp/english/data/cpi/1582.html", what: "How much the prices households pay changed, across Japan.", weekly: false },
    { id: "tokyo_cpi_2", name: "Tokyo CPI, November", publisher: "Statistics Bureau", date: "2026-11-27", date_label: "Fri Nov 27", time: "8:30 a.m. JST", url: "https://www.stat.go.jp/english/data/cpi/1582.html", what: "Prices in Tokyo's 23 wards, published early as a preview of the nation.", weekly: false },
    { id: "labour_force_survey_2", name: "Labour Force Survey, October", publisher: "MHLW", date: "2026-12-01", date_label: "Tue Dec 1", time: "8:30 a.m. JST", url: "https://www.stat.go.jp/english/data/roudou/1543.html", what: "The unemployment rate and how many jobs are on offer per job seeker.", weekly: false },
    { id: "gdp_july_september_2", name: "GDP, July–September, second estimate", publisher: "Cabinet Office", date: "2026-12-08", date_label: "Tue Dec 8", time: "", url: "https://www.esri.cao.go.jp/jp/sna/kouhyou/kouhyou_top.html", what: "A revised reading of how much the economy grew or shrank in the quarter.", weekly: false },
    { id: "national_cpi_3", name: "National CPI, November", publisher: "Statistics Bureau", date: "2026-12-18", date_label: "Fri Dec 18", time: "8:30 a.m. JST", url: "https://www.stat.go.jp/english/data/cpi/1582.html", what: "How much the prices households pay changed, across Japan.", weekly: false },
    { id: "minutes_of_the_october_meeting", name: "Minutes of the October meeting", publisher: "BoJ", date: "2026-12-23", date_label: "Wed Dec 23", time: "8:50 a.m. JST", url: "https://www.boj.or.jp/en/mopo/mpmsche_minu/index.htm", what: "A fuller record of the October debate.", weekly: false },
    { id: "tokyo_cpi_3", name: "Tokyo CPI, December", publisher: "Statistics Bureau", date: "2026-12-25", date_label: "Fri Dec 25", time: "8:30 a.m. JST", url: "https://www.stat.go.jp/english/data/cpi/1582.html", what: "Prices in Tokyo's 23 wards, published early as a preview of the nation.", weekly: false },
    { id: "labour_force_survey_3", name: "Labour Force Survey, November", publisher: "MHLW", date: "2026-12-25", date_label: "Fri Dec 25", time: "8:30 a.m. JST", url: "https://www.stat.go.jp/english/data/roudou/1543.html", what: "The unemployment rate and how many jobs are on offer per job seeker.", weekly: false },
    { id: "summary_of_opinions_2", name: "Summary of Opinions, December meeting", publisher: "BoJ", date: "2026-12-28", date_label: "Mon Dec 28", time: "8:50 a.m. JST", url: "https://www.boj.or.jp/en/mopo/mpmsche_minu/index.htm", what: "Unnamed comments from each Board member at the December meeting.", weekly: false },
  ],
};
