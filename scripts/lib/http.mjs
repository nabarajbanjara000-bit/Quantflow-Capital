// Small network helpers shared by every data source. No dependencies.
export const UA = "QuantFlow-CentralBankMonitor/2.0 (educational research; contact via website)";
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function getText(url, { tries = 3, timeout = 30000, headers = {} } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, ...headers }, signal: ctl.signal });
      clearTimeout(t);
      if (r.status === 429 || r.status >= 500) throw Object.assign(new Error(`HTTP ${r.status}`), { retry: true });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url.replace(/api_key=[^&]+/, "api_key=***")}`);
      return await r.text();
    } catch (e) {
      clearTimeout(t); last = e;
      if (i < tries - 1) await sleep(1500 * (i + 1));
    }
  }
  throw last;
}
export const getJson = async (url, o) => JSON.parse(await getText(url, o));

// Minimal CSV parser (quotes, commas, CRLF). Returns an array of rows (arrays of strings).
export function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
// CSV with a header row -> array of objects.
export function csvObjects(text) {
  const [h, ...r] = parseCsv(text.replace(/^﻿/, ""));
  return r.filter(x => x.length > 1).map(x => Object.fromEntries(h.map((k, i) => [k.trim(), x[i]])));
}

// Month/period strings -> ISO date. "2026-08" -> 2026-08-01, "2026-Q3" -> 2026-07-01, "2026" -> 2026-01-01, "2026-08-31" unchanged.
export function isoDate(s) {
  s = String(s).trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{4})-?Q([1-4])$/i))) return `${m[1]}-${String((m[2] - 1) * 3 + 1).padStart(2, "0")}-01`;
  if ((m = s.match(/^(\d{4})-?(\d{2})$/))) return `${m[1]}-${m[2]}-01`;
  if ((m = s.match(/^(\d{4})$/))) return `${m[1]}-01-01`;
  throw new Error(`unrecognised date "${s}"`);
}
