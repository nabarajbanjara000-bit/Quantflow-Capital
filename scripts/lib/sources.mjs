// The toolbox handed to every country's `get()` function.
import { getText, getJson, parseCsv, csvObjects, isoDate, sleep } from "./http.mjs";

export function makeCtx({ today, fredKey = process.env.FRED_API_KEY || "", mock = false } = {}) {
  // FRED (St. Louis Fed): newest-first observations [{date,value,released}].
  async function fred(series, { limit = 30, start } = {}) {
    if (!fredKey) throw new Error("FRED_API_KEY is not set");
    const q = new URLSearchParams({ series_id: series, api_key: fredKey, file_type: "json", sort_order: "desc", limit: String(limit), ...(start ? { observation_start: start } : {}) });
    const j = await getJson(`https://api.stlouisfed.org/fred/series/observations?${q}`);
    await sleep(250); // stay well under FRED's rate limit
    return (j.observations || []).filter(o => o.value !== "." && o.value !== "").map(o => ({ date: o.date, value: parseFloat(o.value), released: o.realtime_start }));
  }
  return { today, getText, getJson, parseCsv, csvObjects, isoDate, fred, sleep };
}
// Observations helper: sort newest first, drop non-numbers, de-duplicate dates.
export function newestFirst(obs) {
  const seen = new Set();
  return obs.filter(o => o && o.date && Number.isFinite(+o.value) && !seen.has(o.date) && seen.add(o.date)).map(o => ({ ...o, value: +o.value })).sort((a, b) => (a.date < b.date ? 1 : -1));
}
