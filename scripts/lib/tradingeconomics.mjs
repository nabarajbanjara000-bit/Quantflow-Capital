// Trading Economics scraper for sovereign yields and money market rates
// Fallback for jurisdictions whose central bank or treasury websites use Cloudflare bot protection.
import { getText } from "./http.mjs";

const MONTH_MAP = {
  January: "01", February: "02", March: "03", April: "04", May: "05", June: "06",
  July: "07", August: "08", September: "09", October: "10", November: "11", December: "12"
};

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
};

export async function fetchTeYield(path) {
  const url = `https://tradingeconomics.com${path}`;
  const html = await getText(url, { headers: BROWSER_HEADERS });
  
  const chartMeta = html.match(/TEChartsMeta\s*=\s*(\[\{.*?\}\]);/);
  let val = chartMeta ? JSON.parse(chartMeta[1])[0]?.value : null;
  const metaMatch = html.match(/<meta id="metaDesc" name="description" content="([^"]+)"/);
  const desc = metaMatch ? metaMatch[1] : "";

  const dateMatch = desc.match(/on ([A-Za-z]+) (\d{1,2}), (\d{4})/);
  let date = null;
  if (dateMatch) {
    const [, mName, day, year] = dateMatch;
    const mm = MONTH_MAP[mName];
    if (mm) date = `${year}-${mm}-${day.padStart(2, "0")}`;
  }
  if (val == null) {
    const valMatch = desc.match(/(?:rose to|fell to|held steady at|yield on [^%]+ at) ([\d.]+)%/i);
    if (valMatch) val = parseFloat(valMatch[1]);
  }
  if (val == null || !date) throw new Error(`Could not parse TradingEconomics data for ${path}`);

  const curDate = new Date(`${date}T00:00:00Z`);
  const prevDateObj = new Date(curDate.getTime());
  do {
    prevDateObj.setUTCDate(prevDateObj.getUTCDate() - 1);
  } while (prevDateObj.getUTCDay() === 0 || prevDateObj.getUTCDay() === 6);
  const prevDate = prevDateObj.toISOString().slice(0, 10);

  const chgMatch = desc.match(/marking a ([\d.]+) percentage points? (increase|decrease)/i);
  let prevVal = val;
  if (chgMatch) {
    const diff = parseFloat(chgMatch[1]);
    if (chgMatch[2].toLowerCase() === "increase") prevVal = val - diff;
    else if (chgMatch[2].toLowerCase() === "decrease") prevVal = val + diff;
  }
  return [
    { date, value: Math.round(val * 1000) / 1000 },
    { date: prevDate, value: Math.round(prevVal * 1000) / 1000 }
  ];
}

export const teYield = (path, decimals = 2) => ({
  kind: "pct",
  freq: "d",
  decimals,
  source: "Trading Economics (market data)",
  url: `https://tradingeconomics.com${path}`,
  get: () => fetchTeYield(path)
});
