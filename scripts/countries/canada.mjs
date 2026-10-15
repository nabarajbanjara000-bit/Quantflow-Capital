// Canada: Bank of Canada Valet API (key-less JSON) + Statistics Canada Web Data Service (key-less JSON, POST).
const VALET = "https://www.bankofcanada.ca/valet/observations";
const WDS = "https://www150.statcan.gc.ca/t1/wds/rest/getDataFromCubePidCoordAndLatestNPeriods";

// Bank of Canada Valet series -> newest-first observations.
const valet = (series, n = 30) => async ({ getJson }) => {
  const j = await getJson(`${VALET}/${series}/json?recent=${n}`);
  return j.observations.map(o => ({ date: o.d, value: +o[series].v })).sort((a, b) => (a.date < b.date ? 1 : -1));
};
// Statistics Canada table + coordinate -> newest-first observations. `conv` may turn the whole (newest-first) series into another one.
const statcan = (pid, coord, n = 16, conv = x => x) => async () => {
  const body = [{ productId: pid, coordinate: coord.split(".").concat(Array(10).fill("0")).slice(0, 10).join("."), latestN: n }];
  const r = await fetch(WDS, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`StatCan WDS HTTP ${r.status}`);
  const [j] = await r.json();
  if (j.status !== "SUCCESS") throw new Error(`StatCan WDS ${pid} ${coord}: ${j.status}`);
  return conv(j.object.vectorDataPoint.filter(p => p.value != null).map(p => ({ date: p.refPer, value: +p.value, released: p.releaseTime?.slice(0, 10) })).reverse());
};
// Percent change vs `lag` periods earlier (levels newest first -> percent obs).
const chg = lag => xs => xs.slice(0, -lag).map((o, i) => ({ ...o, value: Math.round((o.value / xs[i + lag].value - 1) * 1000) / 10 || 0 }));
const div = k => xs => xs.map(o => ({ ...o, value: o.value / k }));

const LFS = "14100287", CPI = "18100004";
const lfs = (char, age = 1) => statcan(LFS, `1.${char}.1.${age}.1.1`, 6); // geography.characteristic.gender.age.statistic.data type
const cpi = p => statcan(CPI, `2.${p}`, 16);

export default {
  code: "canada",
  // Source: https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rate/ ("Schedule for 2026 / 2027"); announcements 9:45 a.m. ET (https://www.bankofcanada.ca/press/upcoming-events/)
  meetings: [
    { start: null, end: "2026-10-28", label: "Wednesday, October 28, 2026, together with a new Monetary Policy Report (the BoC’s full forecast, published four times a year)", decision_label: "Wednesday, Oct 28, 9:45 a.m. Eastern Time (when the BoC publishes its press release)" },
    { start: null, end: "2026-12-09", label: "Wednesday, December 9, 2026", decision_label: "Wednesday, Dec 9, 9:45 a.m. Eastern Time (when the BoC publishes its press release)" },
    { start: null, end: "2027-01-27", label: "Wednesday, January 27, 2027, together with a new Monetary Policy Report (the BoC’s full forecast, published four times a year)", decision_label: "Wednesday, Jan 27, 9:45 a.m. Eastern Time (when the BoC publishes its press release)" },
    { start: null, end: "2027-03-03", label: "Wednesday, March 3, 2027", decision_label: "Wednesday, Mar 3, 9:45 a.m. Eastern Time (when the BoC publishes its press release)" },
  ],
  calendar_url: "https://www.bankofcanada.ca/core-functions/monetary-policy/key-interest-rate/",
  calendar_label: "Official BoC announcement schedule",
  // Feed list: https://www.bankofcanada.ca/rss-feeds/
  feeds: [
    { id: "decisions", url: "https://www.bankofcanada.ca/content_type/press-releases/feed/" },
    { id: "deliberations", url: "https://www.bankofcanada.ca/content_type/summary-of-deliberations/feed/" },
    { id: "speeches", url: "https://www.bankofcanada.ca/content_type/speeches/feed/" },
  ],
  allowed_domains: ["bankofcanada.ca", "statcan.gc.ca", "www150.statcan.gc.ca", "canada.ca", "fin.gc.ca"],
  indicators: [
    { id: "consumer_price_index_cpi_all_items", kind: "yoy_mom", freq: "m", decimals: 1, get: valet("V41690973", 30) },
    { id: "cpi_trim_boc_core_measure", kind: "pct", freq: "m", decimals: 1, get: valet("CPI_TRIM") },
    { id: "cpi_median_boc_core_measure", kind: "pct", freq: "m", decimals: 1, get: valet("CPI_MEDIAN") },
    { id: "cpi_without_food_and_energy_cpi_xfet", kind: "pct", freq: "m", decimals: 1, get: valet("STATIC_CPIXFET") },
    { id: "cpi_without_gasoline", kind: "yoy_mom", freq: "m", decimals: 1, get: cpi(302) },
    { id: "gasoline_prices", kind: "yoy_mom", freq: "m", decimals: 1, get: cpi(184) },
    { id: "rent", kind: "yoy_mom", freq: "m", decimals: 1, get: cpi(81) },
    { id: "food_from_stores", kind: "yoy_mom", freq: "m", decimals: 1, get: cpi(4) },
    // Labour Force Survey, table 14-10-0287-01 (seasonally adjusted), coordinate = characteristic.gender.age.statistic.data type
    { id: "employment_change", kind: "chg_k", freq: "m", get: statcan(LFS, "1.3.1.1.1.1", 6) },
    { id: "unemployment_rate", kind: "pct", freq: "m", get: lfs(7) },
    { id: "participation_rate", kind: "pct", freq: "m", get: lfs(8) },
    { id: "employment_rate", kind: "pct", freq: "m", get: lfs(9) },
    { id: "youth_unemployment_15_24", kind: "pct", freq: "m", get: lfs(7, 2) },
    // 14-10-0288-01 employment by class of worker (public sector employees, SA)
    { id: "public_sector_jobs", kind: "chg_k", freq: "m", get: statcan("14100288", "1.3.1.1.1", 6) },
    // 14-10-0063-01 average hourly wage rate, all employees (unadjusted): year-over-year change computed here
    { id: "average_hourly_wages", kind: "pct", freq: "m", decimals: 1, get: statcan("14100063", "1.2.1.1.1.1", 16, chg(12)) },
    // 36-10-0104-01 real GDP, expenditure-based, quarterly % change (chained 2017 dollars)
    { id: "real_gdp_growth_spring", kind: "pct", freq: "q", decimals: 1, get: statcan("36100104", "1.7.1.30", 8) },
    // 36-10-0434-01 monthly GDP by industry (SAAR, chained 2017 $): month-on-month change computed here
    { id: "monthly_gdp", kind: "pct", freq: "m", decimals: 1, get: statcan("36100434", "1.1.1.1", 8, chg(1)) },
    { id: "retail_sales", kind: "mom", freq: "m", get: statcan("20100056", "1.1.1.2", 6) },
    { id: "merchandise_trade_balance", kind: "level", freq: "m", decimals: 1, prefix: "$", suffix: " billion", get: statcan("12100011", "1.3.2.2.1", 6, div(1000)) },
    { id: "household_saving_rate", kind: "pct", freq: "q", decimals: 1, get: statcan("36100112", "1.1.33", 6) },
    { id: "building_permits", kind: "level", freq: "m", decimals: 1, prefix: "$", suffix: " billion", get: statcan("34100292", "1.1.1.1.2", 6, div(1e6)) },
    // Bank of Canada Valet
    { id: "boc_policy_rate_overnight_rate_target", kind: "pct", freq: "d", decimals: 2, get: valet("V39079", 10) },
    { id: "corra_overnight_lending_rate", kind: "pct", freq: "d", decimals: 2, get: valet("AVG.INTWO", 10) },
    { id: "2_year_government_of_canada_bond", kind: "pct", freq: "d", decimals: 2, get: valet("BD.CDN.2YR.DQ.YLD", 10) },
    { id: "5_year_government_of_canada_bond", kind: "pct", freq: "d", decimals: 2, get: valet("BD.CDN.5YR.DQ.YLD", 10) },
    { id: "10_year_government_of_canada_bond", kind: "pct", freq: "d", decimals: 2, get: valet("BD.CDN.10YR.DQ.YLD", 10) },
    { id: "canadian_dollar_us_1_in_c", kind: "level", freq: "d", decimals: 4, prefix: "C$", get: valet("FXUSDCAD", 10) },
  ],
  kpis: [
    { id: "boc_policy_rate_overnight_rate_target", label: "Bank of Canada rate" },
    { id: "consumer_price_index_cpi_all_items", label: "Price rise, past year" },
    { id: "unemployment_rate", label: "Unemployment" },
    { id: "10_year_government_of_canada_bond", label: "10-year bond rate" },
  ],
  overview: {
    rate: { id: "boc_policy_rate_overnight_rate_target" },
    prices: { id: "consumer_price_index_cpi_all_items", label: "CPI" },
    jobless: { id: "unemployment_rate", label: "Unemployment rate" },
    tenyr: { id: "10_year_government_of_canada_bond", label: "10-year yield" },
  },
  // Dates: StatCan "2026-2027 release dates" (https://www150.statcan.gc.ca/n1/dai-quo/cal1-eng.htm -> https://www150.statcan.gc.ca/n1/release-diffusion/2026-eng.pdf)
  // and the two-week calendar https://www150.statcan.gc.ca/n1/dai-quo/cal2-eng.htm (8:30 a.m. ET); BoC events: https://www.bankofcanada.ca/press/upcoming-events/
  releases: (() => {
    const SC = "https://www150.statcan.gc.ca/n1/dai-quo/cal2-eng.htm", BOC = "https://www.bankofcanada.ca/press/upcoming-events/";
    const D = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const r = (id, name, publisher, date, time, what, url) => {
      const t = new Date(date + "T00:00:00Z");
      return { id, name, publisher, date, date_label: `${D[t.getUTCDay()]} ${M[t.getUTCMonth()]} ${t.getUTCDate()}`, time, url: url || (publisher === "BoC" ? BOC : SC), what, weekly: false };
    };
    const S = (id, name, date, what) => r(id, name, "StatCan", date, "8:30 a.m. ET", what);
    return [
      S("manufacturing_and_wholesale_tr", "Manufacturing and wholesale trade, August", "2026-10-15", "Sales at factories and wholesalers."),
      S("consumer_price_index_cpi", "Consumer Price Index (CPI), September", "2026-10-19", "How much the prices families pay changed in September, plus the BoC’s core measures."),
      r("business_outlook_survey_and_co", "Business Outlook Survey and Consumer Expectations, Q3", "BoC", "2026-10-19", "11:30 a.m. ET", "The BoC’s own interviews with businesses and survey of households: sales, hiring, prices and inflation expectations."),
      S("new_housing_price_index_and_in", "New Housing Price Index and industrial prices, September", "2026-10-22", "Prices of new homes, and prices factories pay and charge."),
      S("retail_trade", "Retail trade, August", "2026-10-23", "How much people spent in shops."),
      S("gdp_by_industry", "GDP by industry, August", "2026-10-30", "How much the economy grew in August."),
      S("merchandise_trade", "International merchandise trade, September", "2026-11-04", "What Canada sold abroad and bought from abroad."),
      S("labour_force_survey", "Labour Force Survey, October", "2026-11-06", "Jobs and the unemployment rate."),
      r("market_participants_survey", "Market Participants Survey", "BoC", "2026-11-09", "10:30 a.m. ET", "What financial market professionals expect for rates and inflation."),
      r("summary_of_deliberations_oct_2", "Summary of deliberations (Oct 28 meeting)", "BoC", "2026-11-10", "1:30 p.m. ET", "Notes on what officials discussed at the October meeting."),
      S("building_permits", "Building permits, September", "2026-11-12", "How much builders plan to spend on new construction."),
      S("consumer_price_index_cpi_nov", "Consumer Price Index (CPI), October", "2026-11-16", "How much the prices families pay changed in October, plus the BoC’s core measures."),
      S("retail_trade_nov", "Retail trade, September", "2026-11-20", "How much people spent in shops."),
      r("senior_loan_officer_survey", "Senior Loan Officer Survey", "BoC", "2026-11-20", "10:30 a.m. ET", "How banks and other lenders are changing their lending to businesses."),
      S("gdp_income_and_expenditure_q3", "GDP, income and expenditure, third quarter", "2026-11-30", "How much the economy grew in July to September."),
      S("labour_force_survey_dec", "Labour Force Survey, November", "2026-12-04", "Jobs and the unemployment rate."),
      S("consumer_price_index_cpi_dec", "Consumer Price Index (CPI), November", "2026-12-14", "How much the prices families pay changed in November, plus the BoC’s core measures."),
      r("summary_of_deliberations_dec", "Summary of deliberations (Dec 9 meeting)", "BoC", "2026-12-23", "1:30 p.m. ET", "Notes on what officials discussed at the December meeting."),
      S("labour_force_survey_jan", "Labour Force Survey, December", "2027-01-08", "Jobs and the unemployment rate."),
    ];
  })(),
};
