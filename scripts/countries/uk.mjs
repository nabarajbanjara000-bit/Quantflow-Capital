// United Kingdom: Bank of England (IADB), ONS time series, FRED for oil / ECB only.
const BOE_UA = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36" };
const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const p2 = n => String(n).padStart(2, "0");

// ONS time series JSON. shift = months to add: the LFS/vacancy 3-month series are labelled by the MIDDLE month, the page shows the last (checked vs Sep 2026 bulletin); earnings (kai9) is already end-month.
const ons = (topic, id, ds, { shift = 0 } = {}) => async ({ getJson }) => {
  const j = await getJson(`https://www.ons.gov.uk/${topic}/timeseries/${id}/${ds}/data`);
  const rows = j.months?.length ? j.months : j.quarters;
  return rows.map(o => {
    const [y, m] = o.date.split(" ");
    const q = /^Q(\d)$/.exec(m);
    const t = new Date(Date.UTC(+y, (q ? (+q[1] - 1) * 3 + 1 : MON[m]) - 1 + shift, 1));
    // updateDate is UTC (23:00Z the evening before in BST) -> UK release day
    const rel = o.updateDate ? new Date(Date.parse(o.updateDate) + 2 * 3600e3).toISOString().slice(0, 10) : undefined;
    return { date: t.toISOString().slice(0, 10), value: parseFloat(o.value), released: rel };
  }).filter(o => Number.isFinite(o.value)).reverse();
};
// Bank of England IADB daily CSV (needs browser-like User-Agent; URL is the _iadb endpoint)
const boe = code => async ({ getText, today }) => {
  const from = new Date(Date.parse(today) - 120 * 864e5);
  const f = `${p2(from.getUTCDate())}/${Object.keys(MON)[from.getUTCMonth()].replace(/^(.)(.*)$/, (_, a, b) => a + b.toLowerCase())}/${from.getUTCFullYear()}`;
  const t = await getText(`https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=${f}&Dateto=now&SeriesCodes=${code}&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N`, { headers: BOE_UA });
  const lines = t.trim().split(/\r?\n/).slice(1).map(l => l.split(","));
  return lines.map(([d, v]) => { const [dd, mm, yy] = d.split(" "); return { date: `${yy}-${p2(MON[mm.toUpperCase()])}-${dd}`, value: parseFloat(v) }; })
    .filter(o => Number.isFinite(o.value)).reverse();
};
const CPI = "economy/inflationandpriceindices", LM = "employmentandlabourmarket/peopleinwork", GDP = "economy/grossdomesticproductgdp";

export default {
  code: "uk",
  // https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates (fetched Oct 14, 2026: 5 Nov, 17 Dec 2026; 4 Feb 2027, 18 Mar 2027). The page gives no time; Nov 5 MPR "to be published at 12pm" (BoE MPR page).
  meetings: [
    { start: "2026-11-04", end: "2026-11-05", label: "Decision announced Thursday, November 5, 2026, together with a new Monetary Policy Report (the BoE’s full forecast, published four times a year)", decision_label: "Thursday, Nov 5, 12:00 p.m. (noon) UK time, which is GMT after the clocks go back on October 25. That is 7:00 a.m. Eastern Time." },
    { start: "2026-12-16", end: "2026-12-17", label: "Thursday, December 17, 2026", decision_label: "Thursday, Dec 17, 12:00 p.m. (noon) UK time (GMT)" },
    { start: "2027-02-03", end: "2027-02-04", label: "Thursday, February 4, 2027, together with a new Monetary Policy Report", decision_label: "Thursday, Feb 4, 2027 (time not yet published on the BoE page)" },
    { start: "2027-03-17", end: "2027-03-18", label: "Thursday, March 18, 2027", decision_label: "Thursday, Mar 18, 2027 (time not yet published on the BoE page)" },
  ],
  calendar_url: "https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates",
  calendar_label: "Official BoE announcement dates",
  // BoE has no dedicated MPC feed (rss/monetary-policy-* return 404); these three carry MPC summaries/reports, press releases and speeches.
  feeds: [
    { id: "news", url: "https://www.bankofengland.co.uk/rss/news" },
    { id: "speeches", url: "https://www.bankofengland.co.uk/rss/speeches" },
    { id: "publications", url: "https://www.bankofengland.co.uk/rss/publications" },
  ],
  allowed_domains: ["bankofengland.co.uk", "ons.gov.uk", "obr.uk", "gov.uk", "dmo.gov.uk", "ofgem.gov.uk"],
  indicators: [
    { id: "bank_rate", kind: "pct", freq: "d", decimals: 2, get: boe("IUDBEDR") },
    { id: "sonia_overnight_rate_between_banks", kind: "pct", freq: "d", decimals: 3, get: boe("IUDSOIA") },
    { id: "10_year_gilt_yield", kind: "pct", freq: "d", decimals: 2, get: boe("IUDMNPY") },
    { id: "5_year_gilt_yield", kind: "pct", freq: "d", decimals: 2, get: boe("IUDSNPY") },
    { id: "pound_vs_u_s_dollar", kind: "level", freq: "d", decimals: 4, prefix: "US$", get: boe("XUDLUSS") },
    // snapshot also quotes the trade-weighted index (85.35); only the euro rate is automated
    { id: "pound_vs_euro_trade_weighted_index", kind: "level", freq: "d", decimals: 4, prefix: "€", get: boe("XUDLERS") },

    { id: "consumer_price_index_cpi_all_items", kind: "pct", freq: "m", decimals: 1, get: ons(CPI, "d7g7", "mm23") },
    { id: "cpih_cpi_plus_owner_occupiers_housing", kind: "pct", freq: "m", decimals: 1, get: ons(CPI, "l55o", "mm23") },
    { id: "core_cpi_no_energy_food_alcohol_or_tob", kind: "pct", freq: "m", decimals: 1, get: ons(CPI, "dko8", "mm23") },
    { id: "services_inflation", kind: "pct", freq: "m", decimals: 1, get: ons(CPI, "d7nn", "mm23") },
    { id: "goods_inflation", kind: "pct", freq: "m", decimals: 1, get: ons(CPI, "d7nm", "mm23") },
    // CPI 07.2.2 fuels & lubricants annual rate (23.0% Aug, same as the bulletin's motor fuels)
    { id: "motor_fuels", kind: "pct", freq: "m", decimals: 1, get: ons(CPI, "d7io", "mm23") },
    { id: "food_and_non_alcoholic_drinks", kind: "pct", freq: "m", decimals: 1, get: ons(CPI, "d7g8", "mm23") },

    { id: "unemployment_rate_16", kind: "pct", freq: "m", decimals: 1, get: ons("employmentandlabourmarket/peoplenotinwork/unemployment", "mgsx", "lms", { shift: 1 }) },
    { id: "employment_rate_16_64", kind: "pct", freq: "m", decimals: 1, get: ons(LM + "/employmentandemployeetypes", "lf24", "lms", { shift: 1 }) },
    { id: "economic_inactivity_rate_16_64", kind: "pct", freq: "m", decimals: 1, get: ons("employmentandlabourmarket/peoplenotinwork/economicinactivity", "lf2s", "lms", { shift: 1 }) },
    { id: "job_vacancies", kind: "num", freq: "m", get: async c => (await ons(LM + "/employmentandemployeetypes", "ap2y", "lms", { shift: 1 })(c)).map(o => ({ ...o, value: o.value * 1000 })) },
    { id: "regular_pay_growth_no_bonuses", kind: "pct", freq: "m", decimals: 1, get: ons(LM + "/earningsandworkinghours", "kai9", "lms") },

    { id: "gdp_whole_economy_quarterly_growth", kind: "pct", freq: "q", decimals: 1, get: ons(GDP, "ihyq", "qna") },
    // monthly GDP index (1dp) -> month-on-month change
    { id: "monthly_gdp", kind: "mom", freq: "m", get: ons(GDP, "ecy2", "mgdp") },
    { id: "retail_sales_volumes", kind: "pct", freq: "m", decimals: 1, note: "Annual change in volume; month-on-month in ONS bulletin (series J5EC)", get: ons("businessindustryandtrade/retailindustry", "j5eb", "drsi") },
    { id: "household_spending_real", kind: "pct", freq: "q", decimals: 1, note: "Quarterly growth, chained volume", get: ons(GDP, "kg7r", "qna") },

    // untested: needs FRED key (series ids from the research notes)
    { id: "brent_crude_oil", kind: "usd", freq: "d", decimals: 2, unit: "a barrel", get: ({ fred }) => fred("DCOILBRENTEU") },
    { id: "wti_crude_oil", kind: "usd", freq: "d", decimals: 2, unit: "a barrel", get: ({ fred }) => fred("DCOILWTICO") },
    { id: "european_central_bank_deposit_rate", kind: "pct", freq: "d", decimals: 2, get: ({ fred }) => fred("ECBDFR") },
  ],
  kpis: [
    { id: "bank_rate", label: "Bank of England rate" },
    { id: "consumer_price_index_cpi_all_items", label: "Price rise, past year", note: "Goal is 2%" },
    { id: "unemployment_rate_16", label: "Unemployment" },
    { id: "10_year_gilt_yield", label: "10-year gilt rate" },
  ],
  overview: {
    rate: { id: "bank_rate" },
    prices: { id: "consumer_price_index_cpi_all_items", label: "CPI" },
    jobless: { id: "unemployment_rate_16", label: "Unemployment" },
    tenyr: { id: "10_year_gilt_yield", label: "10-year gilt" },
  },
  // Dates checked Oct 14, 2026 on the ONS release pages (https://www.ons.gov.uk/releases/<slug>); PPI from the Aug bulletin "Next release: 21 Oct".
  // Budget date from the OBR announcement (obr.uk returned HTTP 403 to us, not re-verified).
  releases: [
    { id: "gdp_monthly_estimate", name: "GDP monthly estimate, August", publisher: "ONS", date: "2026-10-15", date_label: "Thu Oct 15", time: "7:00 a.m.", url: "https://www.ons.gov.uk/releases/gdpmonthlyestimateukaugust2026", what: "How much the whole economy grew in August (July was +0.4%).", weekly: false },
    { id: "uk_labour_market", name: "UK labour market, October", publisher: "ONS", date: "2026-10-20", date_label: "Tue Oct 20", time: "7:00 a.m.", url: "https://www.ons.gov.uk/releases/uklabourmarketoctober2026", what: "Unemployment for June–August, pay growth, payroll jobs for September and job vacancies.", weekly: false },
    { id: "consumer_price_inflation_cpi", name: "Consumer price inflation (CPI), September", publisher: "ONS", date: "2026-10-21", date_label: "Wed Oct 21", time: "7:00 a.m.", url: "https://www.ons.gov.uk/releases/consumerpriceinflationukseptember2026", what: "How much the prices families pay changed in September, including services and core measures.", weekly: false },
    { id: "producer_price_inflation", name: "Producer price inflation, September", publisher: "ONS", date: "2026-10-21", date_label: "Wed Oct 21", time: "7:00 a.m.", url: "https://www.ons.gov.uk/releasecalendar", what: "Prices factories pay for materials and fuel, and charge for their goods.", weekly: false },
    { id: "public_sector_finances", name: "Public sector finances, September", publisher: "ONS", date: "2026-10-21", date_label: "Wed Oct 21", time: "7:00 a.m.", url: "https://www.ons.gov.uk/releases/publicsectorfinancesukseptember2026", what: "How much the government borrowed.", weekly: false },
    { id: "private_rents_and_house_prices", name: "Private rents and house prices", publisher: "ONS", date: "2026-10-21", date_label: "Wed Oct 21", time: "9:30 a.m.", url: "https://www.ons.gov.uk/releases/privaterentandhousepricesukoctober2026", what: "Average rents and house prices.", weekly: false },
    { id: "retail_sales", name: "Retail sales, September", publisher: "ONS", date: "2026-10-23", date_label: "Fri Oct 23", time: "7:00 a.m.", url: "https://www.ons.gov.uk/releases/retailsalesgreatbritainseptember2026", what: "How much people bought in shops and online.", weekly: false },
    { id: "budget_obr_economic_and_fiscal", name: "Budget + OBR Economic and fiscal outlook", publisher: "HM Treasury / OBR", date: "2026-10-28", date_label: "Wed Oct 28", time: "", url: "https://obr.uk/autumn-2026-forecast-date-announced/", what: "The government’s tax and spending plans, with the official fiscal watchdog’s forecast.", weekly: false },
    { id: "gdp_first_estimate", name: "GDP first estimate, July–September", publisher: "ONS", date: "2026-11-12", date_label: "Thu Nov 12", time: "7:00 a.m.", url: "https://www.ons.gov.uk/releases/gdpfirstquarterlyestimateukjulytoseptember2026", what: "How fast the economy grew over the summer.", weekly: false },
    { id: "uk_labour_market_2", name: "UK labour market, November", publisher: "ONS", date: "2026-11-17", date_label: "Tue Nov 17", time: "7:00 a.m.", url: "https://www.ons.gov.uk/releases/uklabourmarketnovember2026", what: "Jobs, unemployment and pay.", weekly: false },
    { id: "cpi", name: "CPI, October", publisher: "ONS", date: "2026-11-18", date_label: "Wed Nov 18", time: "7:00 a.m.", url: "https://www.ons.gov.uk/releases/consumerpriceinflationukoctober2026", what: "Prices in October, the first month of the new £1,723 energy price cap and the temporary VAT cut on electricity.", weekly: false },
    { id: "retail_sales_2", name: "Retail sales, October", publisher: "ONS", date: "2026-11-20", date_label: "Fri Nov 20", time: "7:00 a.m.", url: "https://www.ons.gov.uk/releases/retailsalesgreatbritainoctober2026", what: "Shop spending in October.", weekly: false },
    { id: "boe_mpc_nov", name: "BoE rate decision + Monetary Policy Report", publisher: "Bank of England", date: "2026-11-05", date_label: "Thu Nov 5", time: "12:00 p.m. GMT", url: "https://www.bankofengland.co.uk/monetary-policy/upcoming-mpc-dates", what: "The MPC’s interest rate decision, with minutes and the new forecast.", weekly: false },
  ],
};
