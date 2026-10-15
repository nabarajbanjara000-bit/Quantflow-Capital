#!/usr/bin/env node
// One-time: turns scripts/seed/<code>.extract.json (made by extract_panels.py from the hand-checked
// Oct 14, 2026 snapshot) into the data file the page reads: public/monitor/data/<code>.json.
// After this, scripts/update.mjs keeps those files current. Safe to re-run, but it overwrites the data files.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addDays, d, iso, longDate, MONTHS } from "../lib/indicators.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SEED = path.join(ROOT, "scripts", "seed");
const OUT = path.join(ROOT, "public", "monitor", "data");
const ASOF = { us: "2026-10-13" }; // everything else was checked on Oct 14
const DEFAULT_ASOF = "2026-10-14";
export const CODES = ["us", "japan", "germany", "canada", "newzealand", "australia", "switzerland", "uk"];
// Decision dates at the time of the snapshot (from each bank's published calendar; the daily job reads them from scripts/countries/*.mjs).
const NEXT = { us: ["2026-10-27", "2026-10-28", "2026-12-08", "2026-12-09"], japan: [null, "2026-10-30"], germany: [null, "2026-10-29"], canada: [null, "2026-10-28"],
  newzealand: [null, "2026-10-28"], australia: [null, "2026-11-03"], switzerland: [null, "2026-12-10"], uk: [null, "2026-11-05"] };
const TIME = { us: "2:00 p.m. ET", japan: "around noon JST", germany: "2:15 p.m. CET", canada: "9:45 a.m. ET", newzealand: "2:00 p.m. NZDT (9:00 p.m. ET Oct 27)", australia: "2:30 p.m. AEDT (10:30 p.m. ET Nov 2)", switzerland: "9:30 a.m. CET", uk: "12:00 p.m. GMT (7:00 a.m. ET)" };
const GROUP_IDS = ["prices", "jobs", "growth", "rates", "said", "global"];
const slug = (s, n = 38) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, n).replace(/_$/, "");
const unesc = s => String(s).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const stripEm = s => s.replace(/^(What it is:|Why it matters:|What it said:|What he said:|What she said:|What they said:)\s*/i, "");

function releaseDate(when, asof) {
  const m = when.match(/([A-Z][a-z]{2}) (\d{1,2})$/);
  const y0 = +asof.slice(0, 4);
  if (m) {
    const mo = MONTHS.indexOf(m[1]);
    let y = y0; if (mo + 1 < +asof.slice(5, 7) - 1) y = y0 + 1; // late-year snapshot, early-year date
    return `${y}-${String(mo + 1).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`;
  }
  const v = when.match(/(Early|Mid|Late)[ -]*(\w+)/i);   // "Late October", "Late Oct / early Nov": sort position only, flagged approx
  if (v) { const mo = MONTHS.findIndex(mm => v[2].toLowerCase().startsWith(mm.toLowerCase())); if (mo >= 0) return { date: `${y0}-${String(mo + 1).padStart(2, "0")}-${{ early: "05", mid: "15", late: "26" }[v[1].toLowerCase()]}`, approx: true }; }
  if (/^Every business day/.test(when)) return asof;
  const w = when.match(/Every (\w+)/);
  if (w) { const idx = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].indexOf(w[1]); if (idx < 0) return asof; let t = asof; while (d(t).getUTCDay() !== idx) t = addDays(t, 1); return t; }
  return null;
}

function build(code) {
  const x = JSON.parse(fs.readFileSync(path.join(SEED, `${code}.extract.json`), "utf8"));
  const asof = ASOF[code] || DEFAULT_ASOF;
  const ov = x.overview;
  // ---- indicators + narrative.indicators + said
  const groups = [], indicators = {}, nInd = {}, intros = {}, missing = {}, used = new Set();
  let said = [];
  x.data.G.forEach((g, gi) => {
    const gid = GROUP_IDS[gi];
    intros[gid] = g.intro; missing[gid] = g.missing || [];
    if (gid === "said") {
      groups.push({ id: gid, name: g.name, indicator_ids: [] });
      said = g.rows.map(r => ({ n: r.n, v: r.v, p: r.p, r: r.r, pv: r.pv, s: r.s, u: r.u, now: r.now, w: r.w }));
      return;
    }
    const ids = [];
    for (const r of g.rows) {
      let id = slug(r.n), k = 2; while (used.has(id)) id = `${slug(r.n, 34)}_${k++}`;
      used.add(id); ids.push(id);
      indicators[id] = { id, group: gid, name: r.n, source: r.s, url: r.u, value: r.v, period: r.p, released: r.r, previous: r.pv, tag: r.t, manual: true };
      nInd[id] = { now_label: r.now[1], now_tone: r.now[0].replace("now-", ""), what: stripEm(r.w[0] || ""), why: stripEm(r.w[1] || "") };
    }
    groups.push({ id: gid, name: g.name, indicator_ids: ids });
  });
  // ---- meetings
  const [s1, e1, s2, e2] = NEXT[code];
  const mt = x.meeting_text;
  const meeting = { next: { start: s1, end: e1, time_label: TIME[code], label: unesc(mt.meeting).replace(/<[^>]+>/g, ""), decision_label: unesc(mt.decision).replace(/<[^>]+>/g, "") },
    after: mt.after ? { start: s2 || null, end: e2 || null, label: unesc(mt.after).replace(/<[^>]+>/g, "") } : null,
    calendar_url: mt.calendar_url, calendar_label: mt.calendar_label, who: mt.who };
  // ---- releases (upcoming reports) + explanations
  const releases = [], reports = {};
  for (const r of x.change.table) {
    if (/^decision$/i.test(r.timing) || /^The (next|following) decision/i.test(r.what)) continue; // decisions are drawn from `meeting`
    let date = releaseDate(r.when, asof), approx = false; if (date && date.date) ({ date, approx } = date); if (!date) continue;
    const rid = slug(r.name.replace(/,\s*[A-Za-z0-9 –-]+$/, ""), 30);
    let id = rid, k = 2; while (releases.find(q => q.id === id)) id = `${rid}_${k++}`;
    releases.push({ id, name: unesc(r.name), publisher: r.publisher, date, date_label: r.when, time: r.time, url: r.url, what: r.what, weekly: /^Every /.test(r.when), ...(approx ? { approx: true, timing: r.timing.toLowerCase().startsWith("before") ? "before" : r.timing.toLowerCase().startsWith("meeting") ? "day" : "after" } : {}) });
    reports[id] = { why: r.why, trigger: r.trigger };
  }
  // ---- narrative (shape shared with the updater's AI step)
  const v = x.verdict;
  v.card_why = ov.card_why; v.last_move = ov.last_move;
  delete v.bars_aria;
  const narrative = {
    what_changed: { headline: "Starting snapshot, checked by hand.", items: [] },
    verdict: v, why_steps: x.why_steps, timeline: x.timeline, choices: x.choices,
    change: { lead: x.change.lead, intro_title: x.change.intro_title, intro: x.change.intro, reports, other_title: x.change.other_title, other: x.change.other },
    report_card: x.report_card, indicators: nInd, said, gaps: x.gaps, group_intros: intros,
  };
  const copy = { story_intro: x.story_intro, choices_intro: x.choices_intro, report_intro: x.report_intro, gaps_intro: x.gaps_intro, numbers_intro: x.numbers_intro,
    live_before: x.live_before, live_after: x.live_after, live_kind: x.live_kind, live_caption: x.live_caption, live_snapshot_col: x.live_snapshot_col,
    change_caption: x.change.caption, change_head: x.change.head, decision_row: x.change.decision_row, titles: x.titles, verdict_note: x.verdict_note, why_title: x.why_title, rough_title: x.rough_title,
    rc_labels: Object.fromEntries(x.report_card.map(r => [r.area, r.change_label])), missing, currency_note: x.country.currency_note };
  const { currency_note, ...cty } = x.country;
  const country = { code, short: ov.short, name: ov.country, bank: ov.bank, abbrev: ov.abbrev, currency_note, ...cty };
  const strings = (o, a = []) => (typeof o === "string" ? a.push(o) : o && typeof o === "object" && Object.values(o).forEach(v => strings(v, a)), a);
  const quoteBank = [...new Set(strings(narrative).flatMap(s => [...s.replace(/<[^>]+>/g, "").matchAll(/[“"]([^”"]{15,400})[”"]/g)].map(m => m[1].trim())))];
  const out = {
    schema: 2, code, asof_date: asof, asof_label: longDate(asof), generated_at: new Date().toISOString(), data_updated_at: null, narrative_updated_at: null,
    narrative_stale: false, narrative_model: "hand-checked snapshot",
    country, meeting, kpis: [], kpis_seed: x.kpis_seed, groups, indicators, releases, narrative, copy,
    overview: { short: ov.short, country: ov.country, bank: ov.bank, abbrev: ov.abbrev, rate: ov.rate, last_move: ov.last_move, card_why: ov.card_why, mini: ov.mini, rate_label: x.country.rate_label, time_label: TIME[code] },
    live_series: x.data.S, quote_bank: quoteBank, changelog: [],
    qa: { data_errors: [], ai_errors: [], coverage: { automatic: 0, manual: Object.keys(indicators).length } },
  };
  return out;
}

fs.mkdirSync(OUT, { recursive: true });
let paragraph = "";
for (const c of CODES) {
  const o = build(c);
  paragraph = JSON.parse(fs.readFileSync(path.join(SEED, `${c}.extract.json`), "utf8")).overview_paragraph;
  fs.writeFileSync(path.join(OUT, `${c}.json`), JSON.stringify(o, null, 1));
  fs.writeFileSync(path.join(SEED, `${c}.indicators.json`), JSON.stringify(Object.values(o.indicators).map(i => ({ id: i.id, group: i.group, name: i.name, seed_value: i.value, seed_period: i.period, source: i.source, url: i.url })), null, 1));
  console.log(c.padEnd(12), "indicators", Object.keys(o.indicators).length, "| releases", o.releases.length, "| said", o.narrative.said.length, "| quotes", o.quote_bank.length);
}

// Starting overview page data (the daily job rewrites this file).
const cs = CODES.map(c => JSON.parse(fs.readFileSync(path.join(OUT, `${c}.json`), "utf8")));
const rows = cs.map(j => { const v = j.narrative.verdict, m = j.meeting.next; return { code: j.code, short: j.overview.short, country: j.overview.country, bank: j.overview.bank, abbrev: j.overview.abbrev, rate: j.overview.rate, last_move: j.overview.last_move, why: j.overview.card_why, mini: j.overview.mini,
  call: v.most_likely, headline: v.headline, probabilities: v.probabilities, confidence: v.confidence, next_end: m.end, next_label: `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d(m.end).getUTCDay()]} ${MONTHS[d(m.end).getUTCMonth()]} ${d(m.end).getUTCDate()}`, time_label: j.overview.time_label, stale: false, asof: j.asof_label, coverage: j.qa.coverage }; });
rows.sort((a, b) => a.next_end.localeCompare(b.next_end));
const names = { hold: "Hold", raise: "Raise", cut: "Cut" }, calls = rows.reduce((a, c) => (a[c.call] = (a[c.call] || 0) + 1, a), {});
fs.writeFileSync(path.join(OUT, "overview.json"), JSON.stringify({ generated_at: new Date().toISOString(), asof_label: longDate(DEFAULT_ASOF), headline: Object.entries(calls).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${names[k]} at ${n} of ${rows.length}`).join(" · "), paragraph, window: [rows[0].next_end, rows[rows.length - 1].next_end], countries: rows }, null, 1));
console.log("overview.json written");
