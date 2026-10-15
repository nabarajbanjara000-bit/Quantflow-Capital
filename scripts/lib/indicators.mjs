// Turns raw observations into the text the page shows. Every number on the page is produced here, by code.
//
// A data source (see scripts/countries/*.mjs) returns observations, NEWEST FIRST:
//     [{ date: "2026-08-01", value: 3.1, released: "2026-09-16" /* optional */ }, ...]
// The indicator's `kind` decides how they are shown:
//   yoy_mom  index level -> "+3.4% vs a year ago" (+ "% in the month")   (needs 13+ monthly values)
//   mom_yoy  same, month change first
//   mom      % change from the previous value only
//   pct      value is already a percent  ("4.2%")        opts: decimals
//   level    plain number with optional prefix/suffix    opts: decimals, prefix, suffix  (e.g. "¥", " per euro")
//   chg_k    change from previous value, series in thousands (jobs added)
//   num      whole number with thousands separators
//   mil_k    series in thousands, shown in millions
//   usd      "$96.24 a barrel"                           opts: decimals, unit
//   range    (US only) target range from two series: obs = lower, obs2 = upper
//   proj     median projection for the current calendar year
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const d = s => new Date(s + "T00:00:00Z");
export const iso = dt => dt.toISOString().slice(0, 10);
export const addDays = (s, n) => { const t = d(s); t.setUTCDate(t.getUTCDate() + n); return iso(t); };
export const daysBetween = (a, b) => Math.round((d(b) - d(a)) / 86400000);
export const longDate = s => { const t = d(s); return `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}, ${t.getUTCFullYear()}`; };
export const weekday = s => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d(s).getUTCDay()];
export const monthsBack = (date, n) => { const t = d(date); t.setUTCMonth(t.getUTCMonth() - n); return iso(t); };
export function periodLabel(date, freq) {
  const t = d(date);
  if (freq === "m") return `${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
  if (freq === "q") return `Q${Math.floor(t.getUTCMonth() / 3) + 1} ${t.getUTCFullYear()}`;
  if (freq === "a") return `${t.getUTCFullYear()}`;
  if (freq === "w") return `Week ending ${longDate(date)}`;
  return longDate(date);
}
// A value older than this (days) is shown as "Old".
export const STALE_DAYS = { d: 10, w: 21, m: 100, q: 200, a: 400 };

const sign = x => (x >= 0 ? "+" : "−");
const pct1 = x => `${sign(x)}${Math.abs(x).toFixed(1)}%`;
const num = x => Math.round(x).toLocaleString("en-US");

export function clean(obs) {
  return (obs || []).map(o => ({ date: o.date, v: typeof o.value === "number" ? o.value : parseFloat(o.value), rt: o.released || o.realtime_start }))
    .filter(o => o.date && Number.isFinite(o.v));
}

// Returns the display fields, or null when there is nothing usable.
export function computeIndicator(ind, obs, obs2, today) {
  const o = clean(obs);
  if (!o.length) return null;
  const L = o[0], P = o[1];
  const out = { latest_date: L.date, period: periodLabel(L.date, ind.freq), released: L.rt ? longDate(L.rt) : null, value: "", previous: "—" };
  const find = dt => o.find(x => x.date === dt);
  const yoyAt = x => { const y = find(monthsBack(x.date, 12)); return y ? (x.v / y.v - 1) * 100 : null; };
  const momAt = (x, i) => { const p = o[i + 1]; return p ? (x.v / p.v - 1) * 100 : null; };
  const dec = ind.decimals ?? (ind.freq === "d" ? 2 : 1);
  const fixed = x => x.toFixed(dec);
  switch (ind.kind) {
    case "yoy_mom": {
      const y = yoyAt(L), m = momAt(L, 0);
      out.value = y == null ? "n/a" : `${pct1(y)} vs a year ago`;
      if (m != null) out.period += ` (${pct1(m)} in the month)`;
      if (P) { const py = yoyAt(P), pm = momAt(P, 1); out.previous = [py != null ? `${pct1(py)} a year` : null, pm != null ? `${pct1(pm)} in the month` : null].filter(Boolean).join("; ") + ` (${periodLabel(P.date, ind.freq)})`; }
      out.raw = { yoy: y, mom: m };
      break;
    }
    case "mom_yoy": {
      const y = yoyAt(L), m = momAt(L, 0);
      out.value = m == null ? "n/a" : `${pct1(m)} in the month`;
      if (y != null) out.period += ` (${pct1(y)} vs a year ago)`;
      if (P) { const pm = momAt(P, 1); if (pm != null) out.previous = `${pct1(pm)} (${periodLabel(P.date, ind.freq)})`; }
      out.raw = { yoy: y, mom: m };
      break;
    }
    case "mom": {
      const m = momAt(L, 0);
      out.value = m == null ? "n/a" : `${pct1(m)} in the month`;
      if (P) { const pm = momAt(P, 1); if (pm != null) out.previous = `${pct1(pm)} (${periodLabel(P.date, ind.freq)})`; }
      out.raw = { mom: m };
      break;
    }
    case "pct":
      out.value = `${fixed(L.v)}%`;
      if (ind.estimate) out.value += " (estimate)";
      if (P) out.previous = `${fixed(P.v)}% (${periodLabel(P.date, ind.freq)})`;
      out.raw = { v: L.v };
      break;
    case "level": {
      const f = x => `${ind.prefix || ""}${x.toFixed(ind.decimals ?? 2)}${ind.suffix || ""}`;
      out.value = f(L.v);
      if (P) out.previous = `${f(P.v)} (${periodLabel(P.date, ind.freq)})`;
      out.raw = { v: L.v };
      break;
    }
    case "chg_k": {
      const c = P ? (L.v - P.v) * 1000 : null;
      out.value = c == null ? "n/a" : `${sign(c)}${num(Math.abs(c))}`;
      if (o[2]) { const pc = (P.v - o[2].v) * 1000; out.previous = `${sign(pc)}${num(Math.abs(pc))} (${periodLabel(P.date, ind.freq)})`; }
      out.raw = o[3] ? { chg: c, avg3: ((L.v - o[3].v) * 1000) / 3 } : { chg: c };
      break;
    }
    case "num":
      out.value = num(L.v);
      if (P) out.previous = `${num(P.v)} (${periodLabel(P.date, ind.freq)})`;
      out.raw = { v: L.v };
      break;
    case "mil_k":
      out.value = `${(L.v / 1000).toFixed(1)} million`;
      if (P) out.previous = `${(P.v / 1000).toFixed(1)} million (${periodLabel(P.date, ind.freq)})`;
      out.raw = { v: L.v };
      break;
    case "usd":
      out.value = `$${L.v.toFixed(ind.decimals || 2)} ${ind.unit || ""}`.trim();
      if (P) out.previous = `$${P.v.toFixed(ind.decimals || 2)} (${periodLabel(P.date, ind.freq)})`;
      out.raw = { v: L.v };
      break;
    case "range": {
      const u = clean(obs2);
      if (!u.length) return null;
      const lo = L.v, hi = u[0].v;
      out.value = `${lo.toFixed(2)}% – ${hi.toFixed(2)}%`;
      out.period = `In effect ${longDate(L.date)}`;
      const ch = o.findIndex(x => x.v !== lo);
      if (ch > 0) {
        const since = o[ch - 1].date, prevLo = o[ch].v;
        const prevHi = (u.find(x => x.date === o[ch].date) || {}).v;
        out.previous = `${prevLo.toFixed(2)}% – ${prevHi != null ? prevHi.toFixed(2) : "?"}% (before ${longDate(since)})`;
        out.released = `Changed ${longDate(since)}`;
        out.raw = { lo, hi, prevLo, prevHi, changed: since };
      } else out.raw = { lo, hi };
      break;
    }
    case "proj":
      out.value = `Median ${L.v.toFixed(1)}%`;
      out.period = `End of ${d(L.date).getUTCFullYear()}`;
      out.raw = { v: L.v };
      break;
    default: throw new Error(`unknown indicator kind "${ind.kind}"`);
  }
  out.tag = daysBetween(L.date, today) > (STALE_DAYS[ind.freq] || 100) ? "old" : "official";
  return out;
}
