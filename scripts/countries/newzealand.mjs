// New Zealand: Stats NZ (release pages -> CSV/XLSX), RBNZ news feed, FRED fallbacks for market series.
// RBNZ statistics/pages and NZ Treasury answer HTTP 403 to scripted requests (checked Oct 14, 2026), so OCR/yields/FX use FRED (untested).
import zlib from "node:zlib";
import { UA } from "../lib/http.mjs";

const SNZ = "https://www.stats.govt.nz";
const MON = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MM = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const pad = n => String(n).padStart(2, "0");

// --- Stats NZ release pages embed their download links (DocumentLink) in the HTML; slugs are predictable, newest first.
const cache = new Map();
async function bin(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return Buffer.from(await r.arrayBuffer());
}
// slug(monthName, year) -> page slug. step 1 = monthly, 3 = quarterly (Mar/Jun/Sep/Dec).
async function snzAsset(today, slug, step, re) {
  const key = slug + re; if (cache.has(key)) return cache.get(key);
  let y = +today.slice(0, 4), m = +today.slice(5, 7);
  if (step === 3) m = Math.floor(m / 3) * 3;
  const job = (async () => {
    for (let i = 0; i < (step === 3 ? 6 : 8); i++, m -= step) {
      if (m < 1) { m += 12; y--; }
      const r = await fetch(`${SNZ}/information-releases/${slug(MON[m - 1], y)}/`, { headers: { "User-Agent": UA } });
      if (!r.ok) continue;
      const links = [...(await r.text()).matchAll(/DocumentLink&quot;:&quot;(.*?)&quot;/g)].map(x => x[1].replace(/\\/g, ""));
      const hit = links.find(l => re.test(l));
      if (hit) return SNZ + hit;
    }
    throw new Error("no Stats NZ release found for " + re);
  })();
  cache.set(key, job); return job;
}
const csvRows = async (ctx, slug, step, re) => ctx.csvObjects(await ctx.getText(await snzAsset(ctx.today, slug, step, re), { timeout: 90000 }));
const per = p => { const [y, x] = p.split("."); return `${y}-${x}-01`; }; // "2026.06" -> 2026-06-01 (Stats NZ period = month)

// Annual % change from a quarterly/monthly index series (Stats NZ CSV rows for one series ref).
function annual(rows, ref, lag) {
  const s = rows.filter(r => r.Series_reference === ref && r.Data_value !== "NA" && r.Data_value !== "").map(r => ({ date: per(r.Period), v: +r.Data_value })).sort((a, b) => (a.date < b.date ? 1 : -1));
  return s.map((o, i) => s[i + lag] ? { date: o.date, value: (o.v / s[i + lag].v - 1) * 100 } : null).filter(Boolean).slice(0, 24);
}
const cpiRows = ctx => csvRows(ctx, (m, y) => `consumers-price-index-${m}-${y}-quarter`, 3, /tradeables-and-non-tradeables\.csv$/);

// --- minimal XLSX reader (zip + sheet XML), no dependencies. Returns { sheetName: rows[][] }.
function unzip(buf) {
  let e = buf.length - 22; while (buf.readUInt32LE(e) !== 0x06054b50) e--;
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const f = {};
  for (let i = 0; i < n; i++) {
    const meth = buf.readUInt16LE(p + 10), cs = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lo = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nl); p += 46 + nl + xl + cl;
    const d = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28), raw = buf.subarray(d, d + cs);
    f[name] = () => (meth === 0 ? raw : zlib.inflateRawSync(raw)).toString("utf8");
  }
  return f;
}
const unesc = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
function readXlsx(buf) {
  const z = unzip(buf);
  const ss = z["xl/sharedStrings.xml"] ? [...z["xl/sharedStrings.xml"]().matchAll(/<si>(.*?)<\/si>/gs)].map(m => unesc([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(x => x[1]).join(""))) : [];
  const rels = Object.fromEntries([...z["xl/_rels/workbook.xml.rels"]().matchAll(/<Relationship\b[^>]*>/g)].map(m => [m[0].match(/Id="([^"]+)"/)[1], m[0].match(/Target="([^"]+)"/)[1]]));
  const out = {};
  for (const m of z["xl/workbook.xml"]().matchAll(/<sheet\b[^>]*>/g)) {
    const name = unesc(m[0].match(/name="([^"]*)"/)[1]).trim(), rows = [];
    for (const r of z["xl/" + rels[m[0].match(/r:id="([^"]+)"/)[1]].replace(/^\/?(xl\/)?/, "")]().matchAll(/<row\b[^>]*>(.*?)<\/row>/gs)) {
      const row = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)) {
        const col = [...c[1].match(/r="([A-Z]+)\d+"/)[1]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const v = (c[2] || "").match(/<v>([^<]*)<\/v>/)?.[1], t = c[1].match(/t="(\w+)"/)?.[1];
        row[col] = v == null ? "" : t === "s" ? ss[+v] : t === "str" ? unesc(v) : +v;
      }
      rows.push(row);
    }
    out[name] = rows;
  }
  return out;
}
const xlsx = async (ctx, slug, step, re) => readXlsx(await bin(await snzAsset(ctx.today, slug, step, re)));
const num = x => typeof x === "number";

// Quarterly sheet with a year row and a month-name row (HLFS-style "2024 / Jun" columns) -> value row for a series ref, newest first.
function gridByYearMonth(rows, yearRow, monthRow, valueRow) {
  let y = 0; const out = [];
  rows[monthRow].forEach((mo, c) => {
    if (/^\d{4}$/.test(String(rows[yearRow][c] ?? ""))) y = +rows[yearRow][c];
    if (MM[mo] && num(valueRow[c])) out.push({ date: `${y}-${pad(MM[mo])}-01`, value: valueRow[c] });
  });
  return out.reverse();
}
// HLFS Table 1, Total section (series ref e.g. S1F3S = unemployment rate, S1E3S = participation): rows list "2026 | Jun | ... values".
function hlfs(sheet, ref) {
  const h = sheet.findIndex(r => r.includes(ref)), col = sheet[h].indexOf(ref), out = []; let y = 0;
  for (let i = h + 2; i < sheet.length && (/^\d{4}$/.test(String(sheet[i][0])) || sheet[i][0] === "" || sheet[i][0] == null) && MM[sheet[i][1]]; i++) {
    if (sheet[i][0]) y = +sheet[i][0];
    if (num(sheet[i][col])) out.push({ date: `${y}-${pad(MM[sheet[i][1]])}-01`, value: sheet[i][col] });
  }
  return out.reverse();
}
const hlfsGet = ref => async ctx => hlfs((await xlsx(ctx, (m, y) => `labour-market-statistics-${m}-${y}-quarter`, 3, /household-labour-force-survey-[a-z]+-\d{4}-quarter\.xlsx$/))["Table 1"], ref);

const fredObs = (id, o) => ctx => ctx.fred(id, o); // untested: needs FRED key

export default {
  code: "newzealand",
  // RBNZ's published MPC schedule page (https://www.rbnz.govt.nz/monetary-policy/about-monetary-policy/the-official-cash-rate) returns HTTP 403
  // to scripts and to WebFetch, so these two dates are the hand-checked snapshot dates (Oct 28 also appears in RBNZ news feed item "Updates to the October MPR and November FSR").
  meetings: [
    { start: "2026-10-28", end: "2026-10-28",
      label: "October 2026 Monetary Policy Review (a shorter decision without a full new forecast; the full forecast document, the Monetary Policy Statement, comes four times a year)",
      decision_label: "Wednesday, Oct 28, 2:00 p.m. New Zealand time (NZDT). That is 01:00 UTC on Oct 28, or 9:00 p.m. U.S. Eastern Time on Tuesday, Oct 27. A media conference follows from the RBNZ’s Auckland office." },
    { start: "2026-12-09", end: "2026-12-09", label: "Wednesday, December 9, 2026 (Monetary Policy Statement, with new forecasts)", decision_label: "Wednesday, Dec 9, New Zealand time (NZDT)" },
  ],
  calendar_url: "https://www.rbnz.govt.nz/monetary-policy/about-monetary-policy/the-official-cash-rate",
  calendar_label: "Official RBNZ OCR page with upcoming dates",
  feeds: [{ id: "news", url: "https://www.rbnz.govt.nz/feeds/news" }], // RBNZ news releases (includes OCR decisions). No working speeches feed found (other /feeds/* paths 403).
  allowed_domains: ["rbnz.govt.nz", "stats.govt.nz", "treasury.govt.nz", "debtmanagement.treasury.govt.nz", "vote.nz", "federalreserve.gov"],
  indicators: [
    // Stats NZ CPI (index CSV -> annual % computed from the index)
    { id: "consumers_price_index_cpi_all_items", kind: "pct", freq: "q", decimals: 1, get: async ctx => annual(await cpiRows(ctx), "CPIQ.SE9A", 4) },
    { id: "tradables_inflation", kind: "pct", freq: "q", decimals: 1, get: async ctx => annual(await cpiRows(ctx), "CPIQ.SE9NS6000", 4) },
    { id: "non_tradables_inflation", kind: "pct", freq: "q", decimals: 1, get: async ctx => annual(await cpiRows(ctx), "CPIQ.SE9NS6500", 4) },
    // Selected price indexes (monthly food price index)
    { id: "food_prices_selected_price_indexes", kind: "yoy_mom", freq: "m", decimals: 1,
      get: async ctx => { const r = await csvRows(ctx, (m, y) => `selected-price-indexes-${m}-${y}`, 1, /selected-price-indexes-[a-z]+-\d{4}\.csv$/);
        return r.filter(x => x.Series_reference === "CPIM.SE901" && x.Data_value !== "NA").map(x => ({ date: per(x.Period), value: +x.Data_value })).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 30); } },
    // GDP (production, chain volume, seasonally adjusted): % change from previous quarter
    { id: "gross_domestic_product_gdp_production", kind: "pct", freq: "q", decimals: 1,
      get: async ctx => (await csvRows(ctx, (m, y) => `gross-domestic-product-${m}-${y}-quarter`, 3, /gross-domestic-product-[a-z]+-\d{4}-quarter\.csv$/))
        .filter(x => x.Series_reference === "SNEQ.SG01RSC01B01PC" && x.Data_value).map(x => ({ date: per(x.Period), value: +x.Data_value })).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12) },
    // Household Labour Force Survey (XLSX), Table 1 total, seasonally adjusted
    { id: "unemployment_rate_household_labour_for", kind: "pct", freq: "q", decimals: 1, get: hlfsGet("S1F3S") },
    { id: "participation_rate", kind: "pct", freq: "q", decimals: 1, get: hlfsGet("S1E3S") },
    // Producers price index outputs, all industries, % change from previous quarter (Table 1.02)
    { id: "producers_price_index_outputs", kind: "pct", freq: "q", decimals: 1,
      get: async ctx => { const t = (await xlsx(ctx, (m, y) => `business-price-indexes-${m}-${y}-quarter`, 3, /producers-price-index\.xlsx$/))["Table 1.02"];
        const h = t.find(r => r.some(c => /^[A-Z][a-z]{2}-\d{4}$/.test(c))), row = t.find(r => r[2] === "SQU900000");
        return h.map((c, i) => { const m = /^([A-Z][a-z]{2})-(\d{4})$/.exec(c); return m && num(row[i]) ? { date: `${m[2]}-${pad(MM[m[1]])}-01`, value: row[i] } : null; }).filter(Boolean).reverse(); } },
    // Retail trade survey: all industries, seasonally adjusted volume (Table 4) -> % change from previous quarter
    { id: "retail_sales_volume", kind: "pct", freq: "q", decimals: 1,
      get: async ctx => { const t = (await xlsx(ctx, (m, y) => `retail-trade-survey-${m}-${y}-quarter`, 3, /retail-trade-survey-[a-z]+-\d{4}-quarter\.xlsx$/))["Table 4"];
        const lv = gridByYearMonth(t, 3, 4, t.find(r => r[3] === "SF91KS"));
        return lv.map((o, i) => lv[i + 1] ? { date: o.date, value: (o.value / lv[i + 1].value - 1) * 100 } : null).filter(Boolean); } },
    // Goods exports, monthly actual $m (OMT Table 1.02): shown as % vs a year ago
    { id: "goods_exports", kind: "yoy_mom", freq: "m", decimals: 0,
      get: async ctx => { const t = (await xlsx(ctx, (m, y) => `overseas-merchandise-trade-${m}-${y}`, 1, /overseas-merchandise-trade-[a-z]+-\d{4}\.xlsx$/))["Table 1.02"]; let y = 0; const out = [];
        for (const r of t) { if (/^\d{4}$/.test(String(r[0]))) y = +r[0]; if (y && MM[r[1]] && num(r[3])) out.push({ date: `${y}-${pad(MM[r[1]])}-01`, value: r[3] }); }
        return out.reverse(); } },
    // FRED (untested: needs FRED key). OECD monthly series lag; the page flags old values.
    { id: "nz_dollar_in_us_dollars", kind: "level", freq: "d", decimals: 4, prefix: "US$", get: fredObs("DEXNZUS", { limit: 40 }) }, // untested: needs FRED key (Fed H.10)
    { id: "brent_crude_oil", kind: "usd", freq: "d", decimals: 2, unit: "a barrel", get: fredObs("DCOILBRENTEU", { limit: 40 }) }, // untested: needs FRED key
    { id: "wti_crude_oil", kind: "usd", freq: "d", decimals: 2, unit: "a barrel", get: fredObs("DCOILWTICO", { limit: 40 }) }, // untested: needs FRED key
    { id: "us_federal_reserve_rate_top_of_range", kind: "pct", freq: "d", decimals: 2, get: fredObs("DFEDTARU", { limit: 40 }) }, // untested: needs FRED key
    { id: "ecb_deposit_rate", kind: "pct", freq: "d", decimals: 2, get: fredObs("ECBDFR", { limit: 40 }) }, // untested: needs FRED key
  ],
  kpis: [
    { id: "official_cash_rate_ocr", label: "Official Cash Rate" },
    { id: "consumers_price_index_cpi_all_items", label: "Price rise, past year", note: "Target band 1–3%" },
    { id: "unemployment_rate_household_labour_for", label: "Unemployment" },
    { id: "10_year_government_bond_yield", label: "10-year bond rate" },
  ],
  overview: {
    rate: { id: "official_cash_rate_ocr" },
    prices: { id: "consumers_price_index_cpi_all_items", label: "CPI" },
    jobless: { id: "unemployment_rate_household_labour_for", label: "Unemployment" },
    tenyr: { id: "10_year_government_bond_yield", label: "10-year" },
  },
  // Dates/times from Stats NZ's official release calendar export https://www.stats.govt.nz/release-calendar/calendar-export (all 10:45 a.m. NZDT).
  releases: [
    ["selected_price_indexes", "Selected price indexes, September", "2026-10-16", "Fri Oct 16", "Monthly prices for food, rents, petrol, power and some other items.", ],
    ["electronic_card_transactions", "Electronic card transactions, September", "2026-10-16", "Fri Oct 16", "How much people spent using debit and credit cards.", ""],
    ["overseas_merchandise_trade", "Overseas merchandise trade, September", "2026-10-19", "Mon Oct 19", "Goods exports and imports for the month.", ""],
    ["consumers_price_index_cpi", "Consumers price index (CPI), September quarter", "2026-10-22", "Thu Oct 22", "How much the prices families pay changed from July to September, including non-tradables.", ""],
    ["employment_indicators", "Employment indicators, September", "2026-10-28", "Wed Oct 28", "Monthly filled jobs and earnings from tax data.", ""],
    ["labour_market_statistics", "Labour market statistics, September quarter", "2026-11-04", "Wed Nov 4", "Unemployment, employment and wage growth.", ""],
    ["selected_price_indexes_oct", "Selected price indexes, October", "2026-11-17", "Tue Nov 17", "Monthly prices for food, rents, petrol, power and some other items.", ""],
    ["business_price_indexes", "Business price indexes, September quarter", "2026-11-18", "Wed Nov 18", "Producer prices (outputs and inputs).", ""],
    ["retail_trade_survey", "Retail trade survey, September quarter", "2026-11-23", "Mon Nov 23", "How much shops sold, in dollars and in volume.", ""],
    ["gross_domestic_product", "Gross domestic product, September quarter", "2026-12-17", "Thu Dec 17", "Size of the economy and growth in the quarter.", ""],
    ["balance_of_payments", "Balance of payments, September quarter", "2026-12-16", "Wed Dec 16", "The current account: trade and income with the rest of the world.", ""],
  ].map(([id, name, date, date_label, what]) => ({ id, name, publisher: "Stats NZ", date, date_label, time: "10:45 a.m. NZDT", url: "https://www.stats.govt.nz/release-calendar/", what, weekly: false }))
    .concat([
      { id: "monetary_policy_review", name: "RBNZ Monetary Policy Review (OCR decision)", publisher: "RBNZ", date: "2026-10-28", date_label: "Wed Oct 28", time: "2:00 p.m. NZDT", url: "https://www.rbnz.govt.nz/news-and-events/news/2026/10/updates-to-the-october-mpr-and-november-fsr", what: "The OCR decision and the Committee's reasoning.", weekly: false },
      { id: "financial_stability_report", name: "Financial Stability Report", publisher: "RBNZ", date: "2026-11-17", date_label: "Tue Nov 17", time: "9:00 a.m.", url: "https://www.rbnz.govt.nz/news-and-events/news/2026/10/updates-to-the-october-mpr-and-november-fsr", what: "The RBNZ’s check on the health of banks, borrowers and the financial system.", weekly: false },
    ]).sort((a, b) => (a.date < b.date ? -1 : 1)),
};
