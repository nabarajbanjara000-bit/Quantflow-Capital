// Switzerland: SNB data portal + SNB public chart JSON (official), ECB data API (official, for the ECB rate), SNB event schedule/RSS.
const SNB_SCHEDULE = "https://www.snb.ch/en/services-events/digital-services/event-schedule";

// SNB data portal cube (key-less CSV, ';' separated): rows [date, ...dims, value]. Returns [{date, value}] for rows whose dims match.
const cube = (id, dims, fixDate = d => (d.length === 7 ? d + "-01" : d)) => async ({ getText }) => {
  const t = await getText(`https://data.snb.ch/api/cube/${id}/data/csv/en`);
  const out = [];
  for (const line of t.split(/\r?\n/)) {
    const c = line.split(";").map(s => s.replace(/^﻿?"|"$/g, ""));
    if (/^\d{4}-\d{2}/.test(c[0]) && dims.every((d, i) => c[i + 1] === d) && c[dims.length + 1] !== "" && c[dims.length + 1] != null) out.push({ date: fixDate(c[0]), value: +c[dims.length + 1] });
  }
  return out.reverse();
};
// SNB website chart JSON: { key: [[ms, value], ...] } newest first (daily), nulls skipped.
const snbChart = (file, key) => async ({ getJson }) =>
  ((await getJson(`https://www.snb.ch/public/rates/${file}`))[key] || []).filter(p => p[1] != null).map(p => ({ date: new Date(p[0]).toISOString().slice(0, 10), value: p[1] }));

export default {
  code: "switzerland",
  // Source: SNB time schedule (https://www.snb.ch/en/services-events/digital-services/event-schedule): Dec 10 2026, Mar 18 2027, Jun 24 2027, Sep 23 2027 (press release 09:30, news conference 10:00).
  meetings: [
    { start: null, end: "2026-12-10", label: "Thursday, December 10, 2026, the SNB’s quarterly “monetary policy assessment”, with a new conditional inflation forecast", decision_label: "Thursday, Dec 10, 9:30 a.m. Swiss time (CET) press release; news conference at 10:00 a.m." },
    { start: null, end: "2027-03-18", label: "Thursday, March 18, 2027, the SNB’s quarterly “monetary policy assessment”, with a new conditional inflation forecast", decision_label: "Thursday, Mar 18, 9:30 a.m. Swiss time (CET) press release; news conference at 10:00 a.m." },
    { start: null, end: "2027-06-24", label: "Thursday, June 24, 2027, the SNB’s quarterly “monetary policy assessment”, with a new conditional inflation forecast", decision_label: "Thursday, Jun 24, 9:30 a.m. Swiss time (CEST) press release; news conference at 10:00 a.m." },
    { start: null, end: "2027-09-23", label: "Thursday, September 23, 2027, the SNB’s quarterly “monetary policy assessment”, with a new conditional inflation forecast", decision_label: "Thursday, Sep 23, 9:30 a.m. Swiss time (CEST) press release; news conference at 10:00 a.m." },
  ],
  calendar_url: SNB_SCHEDULE,
  calendar_label: "Official SNB time schedule",
  // RSS list: https://www.snb.ch/en/services-events/digital-services/rss-calendar-feeds
  feeds: [
    { id: "press_releases", url: "https://www.snb.ch/public/rss/en/pressrel" },
    { id: "monetary_policy", url: "https://www.snb.ch/public/rss/en/mopo" },
    { id: "speeches", url: "https://www.snb.ch/public/rss/en/speeches" },
  ],
  allowed_domains: ["snb.ch", "data.snb.ch", "bfs.admin.ch", "seco.admin.ch", "admin.ch", "arbeit.swiss", "kof.ethz.ch", "ecb.europa.eu", "federalreserve.gov"],
  indicators: [
    // CPI: SNB data portal republishes the FSO national index (official; lags the FSO release by about a month, so the snapshot's Sep value is newer).
    { id: "consumer_price_index_cpi_all_items", kind: "yoy_mom", freq: "m", decimals: 1, note: "FSO index via SNB data portal (cube plkopr)", get: cube("plkopr", ["LD2010100"]) },
    { id: "snb_policy_rate", kind: "pct", freq: "d", decimals: 2, get: snbChart("interestRates", "snbLz") },
    { id: "rate_on_banks_deposits_above_the_thres", kind: "pct", freq: "d", decimals: 2, get: cube("snbgwdzid", ["ZIG"]) },
    { id: "saron_overnight_rate", kind: "pct", freq: "d", decimals: 2, get: snbChart("interestRates", "sarh") },
    { id: "10_year_confederation_bond_yield", kind: "pct", freq: "d", decimals: 3, get: snbChart("interestRates", "r10") },
    { id: "euro_in_francs", kind: "level", freq: "d", decimals: 4, prefix: "CHF ", get: snbChart("exchangeRates", "eur") },
    { id: "u_s_dollar_in_francs", kind: "level", freq: "d", decimals: 4, prefix: "CHF ", get: snbChart("exchangeRates", "usd") },
    // KOF tsdb API (official KOF/ETH data service; link published on the KOF barometer page)
    { id: "kof_economic_barometer", kind: "level", freq: "m", decimals: 1, get: async ({ getText, parseCsv }) =>
        parseCsv(await getText("https://tsdb-api.kof.ethz.ch/v2/ts?keys=ch.kof.barometer&mime=csv&access_type=public")).slice(1).filter(r => r[1]).map(r => ({ date: r[0], value: +r[1] })).reverse() },
    // ECB data portal, key-less
    { id: "ecb_deposit_rate", kind: "pct", freq: "d", decimals: 2, get: async ({ getText, csvObjects, today }) =>
        csvObjects(await getText("https://data-api.ecb.europa.eu/service/data/FM/D.U2.EUR.4F.KR.DFR.LEV?format=csvdata&startPeriod=" + new Date(Date.parse(today) - 40 * 864e5).toISOString().slice(0, 10)))
          .map(r => ({ date: r.TIME_PERIOD, value: +r.OBS_VALUE })).reverse() },
  ],
  kpis: [
    { id: "snb_policy_rate", label: "SNB policy rate" },
    { id: "consumer_price_index_cpi_all_items", label: "Price rise, past year" },
    { id: "registered_unemployment_rate", label: "Unemployment" },
    { id: "10_year_confederation_bond_yield", label: "10-year bond rate" },
  ],
  overview: {
    rate: { id: "snb_policy_rate" },
    prices: { id: "consumer_price_index_cpi_all_items", label: "CPI" },
    jobless: { id: "registered_unemployment_rate", label: "Registered unemployment" },
    tenyr: { id: "10_year_confederation_bond_yield", label: "10-year Confederation bond" },
  },
  // Dates and times from the SNB time schedule (checked Oct 14, 2026). FSO / SECO / KOF calendars could not be read, so their releases are not listed.
  releases: [
    { id: "summary_of_monetary_policy_dis", name: "Summary of monetary policy discussion (Sep 24)", publisher: "SNB", date: "2026-10-22", date_label: "Thu Oct 22", time: "9:30 a.m.", url: SNB_SCHEDULE, what: "A written summary of what the three Governing Board members discussed at the September assessment.", weekly: false },
    { id: "snb_interim_results", name: "SNB interim results as at Sep 30", publisher: "SNB", date: "2026-10-30", date_label: "Fri Oct 30", time: "7:15 a.m.", url: SNB_SCHEDULE, what: "The SNB’s profit or loss for the first nine months of 2026.", weekly: false },
    { id: "snb_monetary_policy_assessment", name: "SNB monetary policy assessment", publisher: "SNB", date: "2026-12-10", date_label: "Thu Dec 10", time: "9:30 a.m.", url: SNB_SCHEDULE, what: "The SNB’s policy rate decision and new inflation forecast; news conference at 10:00 a.m.", weekly: false },
    { id: "snb_direct_investment", name: "Direct investment 2025", publisher: "SNB", date: "2026-12-11", date_label: "Fri Dec 11", time: "9:00 a.m.", url: SNB_SCHEDULE, what: "Swiss companies’ investment abroad and foreign companies’ investment in Switzerland.", weekly: false },
    { id: "snb_quarterly_bulletin", name: "Quarterly Bulletin 4/2026", publisher: "SNB", date: "2026-12-16", date_label: "Wed Dec 16", time: "3:00 p.m.", url: SNB_SCHEDULE, what: "The SNB’s quarterly report on the economy and its data.", weekly: false },
  ],
};
