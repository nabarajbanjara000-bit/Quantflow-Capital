// United States (Federal Reserve). Numbers come from FRED (St. Louis Fed), which republishes the official data
// from BLS, BEA, Treasury, Census, the Labor Department, EIA and the Fed. Needs FRED_API_KEY.
import { newestFirst } from "../lib/sources.mjs";

// FOMC meetings. Source: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
// Update once a year (the Fed publishes next year's dates mid-year). The decision is announced at 2:00 p.m. ET on `end`.
const FOMC = [
  ["2026-10-27", "2026-10-28"], ["2026-12-08", "2026-12-09"],
  ["2027-01-26", "2027-01-27"], ["2027-03-16", "2027-03-17"], ["2027-04-27", "2027-04-28"], ["2027-06-08", "2027-06-09"], // 2027: tentative
  ["2027-07-27", "2027-07-28"], ["2027-09-14", "2027-09-15"], ["2027-10-26", "2027-10-27"], ["2027-12-07", "2027-12-08"],
];
const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dt = s => new Date(s + "T12:00:00Z");
const meetings = FOMC.map(([start, end]) => {
  const a = dt(start), b = dt(end), same = a.getUTCMonth() === b.getUTCMonth();
  return {
    start, end,
    label: `${DAY[a.getUTCDay()]}–${DAY[b.getUTCDay()]}, ${MON[a.getUTCMonth()]} ${a.getUTCDate()}–${same ? "" : MON[b.getUTCMonth()] + " "}${b.getUTCDate()}, ${b.getUTCFullYear()}`,
    decision_label: `${DAY[b.getUTCDay()]}, ${MON[b.getUTCMonth()].slice(0, 3)} ${b.getUTCDate()}, 2:00 p.m. Eastern Time (when the Fed usually publishes its written statement)`,
    time_label: "2:00 p.m. ET",
  };
});

const BLS_CPI = "https://www.bls.gov/news.release/cpi.nr0.htm", BEA_PIO = "https://www.bea.gov/data/income-saving/personal-income";
const TREASURY_URL = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/TextView?type=daily_treasury_yield_curve&field_tdr_date_value_month=202610";
const f = (id, kind, freq, series, extra = {}) => ({ id, kind, freq, ...extra, get: ({ fred, today }) => fred(series, { limit: kind === "range" ? 1200 : freq === "d" ? 40 : 30 }) });

// Primary source fetcher directly from U.S. Department of the Treasury (always latest daily rates; no API key needed)
let treasuryYieldsCache = null;
async function fetchTreasuryYields({ getText, parseCsv, today }) {
  if (treasuryYieldsCache) return treasuryYieldsCache;
  try {
    const year = (today || new Date().toISOString()).slice(0, 4);
    const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/${year}/all?type=daily_treasury_yield_curve&field_tdr_date_value=${year}&page&_format=csv`;
    const text = await getText(url);
    const [header, ...rows] = parseCsv(text.replace(/^\uFEFF/, ""));
    const h = (header || []).map(k => k.trim());
    const dateIdx = h.indexOf("Date");
    const c3m = h.indexOf("3 Mo");
    const c2y = h.indexOf("2 Yr");
    const c10y = h.indexOf("10 Yr");
    const c30y = h.indexOf("30 Yr");
    const res = { "3_month_treasury_bill": [], "2_year_treasury_yield": [], "10_year_treasury_yield": [], "30_year_treasury_yield": [] };
    for (const r of rows) {
      if (r.length <= 1) continue;
      const rawDate = r[dateIdx];
      const m = rawDate ? rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/) : null;
      if (!m) continue;
      const date = `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
      if (c3m >= 0 && Number.isFinite(+r[c3m])) res["3_month_treasury_bill"].push({ date, value: +r[c3m] });
      if (c2y >= 0 && Number.isFinite(+r[c2y])) res["2_year_treasury_yield"].push({ date, value: +r[c2y] });
      if (c10y >= 0 && Number.isFinite(+r[c10y])) res["10_year_treasury_yield"].push({ date, value: +r[c10y] });
      if (c30y >= 0 && Number.isFinite(+r[c30y])) res["30_year_treasury_yield"].push({ date, value: +r[c30y] });
    }
    treasuryYieldsCache = res;
    return res;
  } catch (e) {
    return null;
  }
}
const trYield = (id, series) => ({
  id, kind: "pct", freq: "d", url: TREASURY_URL,
  get: async (ctx) => {
    const tr = await fetchTreasuryYields(ctx);
    if (tr && tr[id] && tr[id].length) return tr[id];
    return ctx.fred(series, { limit: 40 });
  }
});

export default {
  code: "us",
  meetings,
  calendar_url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", calendar_label: "Official Fed meeting calendar",
  feeds: [
    { id: "monetary", url: "https://www.federalreserve.gov/feeds/press_monetary.xml" },
    { id: "speeches", url: "https://www.federalreserve.gov/feeds/speeches.xml" },
  ],
  allowed_domains: ["federalreserve.gov", "bls.gov", "bea.gov", "treasury.gov", "census.gov", "dol.gov", "eia.gov", "stlouisfed.org", "newyorkfed.org", "atlantafed.org",
    "bankofengland.co.uk", "ecb.europa.eu", "bostonfed.org", "clevelandfed.org", "chicagofed.org", "dallasfed.org", "frbsf.org", "kansascityfed.org", "minneapolisfed.org", "philadelphiafed.org", "richmondfed.org"],
  prompt_notes: `9. **PCE vs CPI:** the Fed's 2% goal is measured with PCE (all items, energy included). Core PCE (without food and energy) is a guide to the trend, not the target. CPI is closely watched but is not the formal target. When you say "PCE", say whether you mean all-items PCE or core PCE.`,
  indicators: [
    f("consumer_price_index_cpi_all_items", "yoy_mom", "m", "CPIAUCSL"),
    f("core_cpi_without_food_and_energy", "yoy_mom", "m", "CPILFESL"),
    f("cpi_energy", "yoy_mom", "m", "CPIENGSL"),
    f("cpi_shelter_housing_costs", "yoy_mom", "m", "CUSR0000SAH1"),
    f("pce_prices_the_fed_s_official_target", "yoy_mom", "m", "PCEPI"),
    f("core_pce_without_food_and_energy", "yoy_mom", "m", "PCEPILFE"),
    f("producer_price_index_ppi_final_demand", "yoy_mom", "m", "PPIFIS"),
    f("10_year_inflation_expectation_from_bon", "pct", "d", "T10YIE"),
    f("new_jobs_nonfarm_payrolls", "chg_k", "m", "PAYEMS"),
    f("unemployment_rate", "pct", "m", "UNRATE"),
    f("average_hourly_pay", "yoy_mom", "m", "CES0500000003"),
    f("labour_force_participation", "pct", "m", "CIVPART"),
    f("weekly_jobless_claims_new", "num", "w", "ICSA"),
    f("continuing_jobless_claims", "num", "w", "CCSA"),
    f("job_openings_jolts", "mil_k", "m", "JTSJOL"),
    f("quit_rate", "pct", "m", "JTSQUR"),
    f("real_gdp_growth_spring", "pct", "q", "A191RL1Q225SBEA", { name: "Real GDP growth (latest quarter, yearly pace)" }),
    f("gdpnow_model_estimate_summer", "pct", "q", "GDPNOW", { name: "GDPNow model estimate (current quarter)", estimate: true }),
    f("retail_sales", "mom_yoy", "m", "RSAFS"),
    f("real_consumer_spending", "mom", "m", "PCEC96"),
    f("real_after_tax_income", "mom", "m", "DSPIC96"),
    f("personal_saving_rate", "pct", "m", "PSAVERT"),
    { id: "fed_s_target_range_federal_funds_rate", kind: "range", freq: "d", get: ({ fred }) => fred("DFEDTARL", { limit: 1200 }), get2: ({ fred }) => fred("DFEDTARU", { limit: 1200 }) },
    f("effective_federal_funds_rate", "pct", "d", "EFFR"),
    trYield("3_month_treasury_bill", "DGS3MO"),
    trYield("2_year_treasury_yield", "DGS2"),
    trYield("10_year_treasury_yield", "DGS10"),
    trYield("30_year_treasury_yield", "DGS30"),
    f("high_yield_credit_spread", "pct", "d", "BAMLH0A0HYM2"),
    f("fed_officials_end_2026_rate_forecast_d", "proj", "a", "FEDTARMD", { name: "Fed officials' median rate forecast for this year (dot plot)", get: ({ fred, today }) => fred("FEDTARMD", { limit: 6, start: `${today.slice(0, 4)}-01-01` }) }),
    f("oil_price_wti_crude", "usd", "d", "DCOILWTICO", { unit: "a barrel" }),
    f("u_s_gasoline_regular", "usd", "w", "GASREGW", { unit: "a gallon", decimals: 3 }),
    f("european_central_bank_deposit_rate", "pct", "d", "ECBDFR"),
  ],
  kpis: [
    { id: "fed_s_target_range_federal_funds_rate", label: "Fed interest rate" },
    { id: "pce_prices_the_fed_s_official_target", label: "Price rise, past year (PCE)", note: "Goal is 2%" },
    { id: "unemployment_rate", label: "Unemployment" },
    { id: "10_year_treasury_yield", label: "10-year bond rate" },
  ],
  overview: { rate: { id: "fed_s_target_range_federal_funds_rate" }, prices: { id: "pce_prices_the_fed_s_official_target", label: "PCE" }, jobless: { id: "unemployment_rate", label: "Unemp." }, tenyr: { id: "10_year_treasury_yield", label: "10-yr" } },
  // Upcoming report dates come live from FRED's release calendar (series -> release -> dates). `id` links to the explanation text.
  fred_releases: [
    { id: "consumer_price_index_cpi", name: "Consumer Price Index (CPI)", publisher: "BLS", series: "CPIAUCSL", time: "8:30 a.m.", url: "https://www.bls.gov/schedule/news_release/cpi.htm", what: "How much the prices families pay changed last month." },
    { id: "producer_price_index_ppi", name: "Producer Price Index (PPI)", publisher: "BLS", series: "PPIFIS", time: "8:30 a.m.", url: "https://www.bls.gov/schedule/news_release/ppi.htm", what: "What businesses charge each other for goods and services." },
    { id: "retail_sales", name: "Retail sales", publisher: "Census", series: "RSAFS", time: "8:30 a.m.", url: "https://www.census.gov/retail/sales.html", what: "How much people spent in shops, restaurants and online." },
    { id: "weekly_jobless_claims", name: "Weekly jobless claims", publisher: "Labor Dept.", series: "ICSA", time: "8:30 a.m.", url: "https://www.dol.gov/ui/data.pdf", what: "How many people newly applied for unemployment benefits.", weekly: true },
    { id: "housing_starts", name: "Housing starts", publisher: "Census", series: "HOUST", time: "8:30 a.m.", url: "https://www.census.gov/construction/nrc/index.html", what: "How many new homes builders began building." },
    { id: "durable_goods_orders", name: "Durable goods orders", publisher: "Census", series: "DGORDER", time: "8:30 a.m.", url: "https://www.census.gov/manufacturing/m3/adv/current/index.html", what: "Orders for long-lasting items like machines and equipment." },
    { id: "gdp_q3_first_estimate_pce_pric", name: "GDP (economic growth)", publisher: "BEA", series: "A191RL1Q225SBEA", time: "8:30 a.m.", url: "https://www.bea.gov/news/schedule", what: "How fast the whole economy grew." },
    { id: "pce_prices_and_spending", name: "PCE prices and consumer spending", publisher: "BEA", series: "PCEPI", time: "8:30 a.m.", url: "https://www.bea.gov/news/schedule", what: "The Fed's preferred price measure, plus income and spending." },
    { id: "employment_cost_index", name: "Employment Cost Index", publisher: "BLS", series: "ECIALLCIV", time: "8:30 a.m.", url: "https://www.bls.gov/schedule/news_release/eci.htm", what: "How fast employers' total pay and benefit costs are rising." },
    { id: "job_openings_jolts", name: "Job openings (JOLTS)", publisher: "BLS", series: "JTSJOL", time: "10:00 a.m.", url: "https://www.bls.gov/schedule/news_release/jolts.htm", what: "How many jobs companies are trying to fill." },
    { id: "jobs_report", name: "Jobs report (Employment Situation)", publisher: "BLS", series: "PAYEMS", time: "8:30 a.m.", url: "https://www.bls.gov/schedule/news_release/empsit.htm", what: "Jobs added and the unemployment rate." },
  ],
  releases: [], // the snapshot's static list is used until FRED is reachable
};
