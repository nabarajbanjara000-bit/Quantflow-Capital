#!/usr/bin/env node
// Global Central Bank Monitor: daily updater (8 countries).
//
// For each country (scripts/countries/<code>.mjs):
//  1. collect the latest numbers from official sources; every number on the page is produced here, by code
//  2. work out the upcoming meetings and report dates
//  3. read new official statements, minutes and speeches (RSS/Atom)
//  4. when something changed (or the text is a week old), ask the AI to rewrite the plain-language text,
//     then check the rewrite against strict rules; on failure retry once, then keep the previous text
//  5. write public/monitor/data/<code>.json, and finally public/monitor/data/overview.json
//
// Environment:
//   FRED_API_KEY       needed for the US (and any FRED-based series): https://fred.stlouisfed.org/docs/api/api_key.html
//   GEMINI_API_KEY     Google Gemini key (https://aistudio.google.com/apikey). GEMINI_MODEL optional (default gemini-3.8-flash).
//   ANTHROPIC_API_KEY  alternative AI (used only if there is no Gemini key). CLAUDE_MODEL / AI_PROVIDER optional.
//   COUNTRIES          optional, e.g. "us,uk" (also accepted as command-line arguments). Default: all eight.
//   FORCE_AI=1         rewrite the text even if nothing changed
//   MOCK=1             offline test: fake data, no network, writes to mock-output/ and never touches the real data
//   DRY_RUN=1          real downloads, but writes to mock-output/ only
//   MOCK_BAD_AI=1      (with MOCK) simulate a bad AI answer to test the safety fallback
//   MOCK_AI=0          (with MOCK) fake data but a real (or local test) AI call
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { addDays, computeIndicator, d, daysBetween, longDate, weekday, iso, MONTHS } from "./lib/indicators.mjs";
import { getText, sleep } from "./lib/http.mjs";
import { makeCtx } from "./lib/sources.mjs";
import { AI_KEY, MOCK, MOCK_AI, MODEL_LABEL, PROVIDER, callAI, extractJson } from "./lib/ai.mjs";
import { allStrings, domainOk, normalize, validate } from "./lib/validate.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "public", "monitor", "data");
const DRY = process.env.DRY_RUN === "1"; // real network, but writes to mock-output/ instead of the page data
const OUT_DIR = MOCK || DRY ? path.join(ROOT, "mock-output") : DATA; // test runs never touch the real page data
const PROMPT = path.join(__dirname, "prompt.md");
const ORDER = ["us", "japan", "germany", "canada", "newzealand", "australia", "switzerland", "uk"];
const TODAY = process.env.MONITOR_TODAY || new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const NARRATIVE_MAX_AGE_DAYS = 7; // rewrite at least weekly, and on any change
const log = (...a) => console.log("[monitor]", ...a);
const warn = (...a) => console.warn("[monitor] WARNING:", ...a);
const readJson = async p => JSON.parse(await fs.readFile(p, "utf8"));
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(`${what} timed out after ${ms / 1000}s`)), ms))]);

// ---------------------------------------------------------------- official news (RSS / Atom)
function stripHtml(h) {
  return h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;|&#x27;/g, "’")
    .replace(/&#8220;|&ldquo;/g, "“").replace(/&#8221;|&rdquo;/g, "”").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}
function parseFeed(xml) {
  const items = [];
  for (const m of xml.matchAll(/<(item|entry)[ >]([\s\S]*?)<\/\1>/g)) {
    const body = m[2];
    const g = tag => { const x = body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`)); return x ? x[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : ""; };
    const link = g("link") || ((body.match(/<link[^>]*href="([^"]+)"/) || [])[1] || "");
    const pub = g("pubDate") || g("updated") || g("published") || g("dc:date");
    const dt = pub ? new Date(pub) : null;
    items.push({ title: stripHtml(g("title")), url: link.trim(), date: dt && !isNaN(dt) ? iso(dt) : "", summary: stripHtml(g("description") || g("summary")).slice(0, 400) });
  }
  return items;
}
async function collectNews(cfg) {
  if (MOCK) return { sources: [], errors: [] };
  const sources = [], errors = [];
  for (const f of cfg.feeds || []) {
    try {
      const items = parseFeed(await getText(f.url)).filter(i => i.date && daysBetween(i.date, TODAY) <= 35).slice(0, 6);
      for (const it of items) {
        let text = it.summary;
        if (it.url && domainOk(it.url, cfg.allowed_domains) && sources.length < 8) {
          try {
            const html = await getText(it.url, { tries: 2 });
            const art = html.match(/<div[^>]+id="article"[^>]*>([\s\S]*?)<div[^>]+(?:id="lastUpdate"|class="lastUpdate")/i);
            text = stripHtml(art ? art[1] : html).slice(0, 6000);
          } catch (e) { errors.push(`page ${it.url}: ${e.message}`); }
        }
        sources.push({ id: `S${sources.length + 1}`, feed: f.id, title: it.title, date: it.date, url: it.url, text });
      }
    } catch (e) { errors.push(`${f.id} feed: ${e.message}`); }
  }
  return { sources, errors };
}

// ---------------------------------------------------------------- numbers
function mockObs(ind) {
  const step = { d: 1, w: 7, m: 30, q: 91, a: 365 }[ind.freq] || 30;
  let date = ind.freq === "m" ? TODAY.slice(0, 8) + "01" : TODAY;
  const out = [];
  for (let i = 0; i < 30; i++) {
    const v = ({ yoy_mom: 100 + (30 - i) * 0.3, mom_yoy: 100 + (30 - i) * 0.3, mom: 100 + (30 - i) * 0.3, chg_k: 150000 + (30 - i) * 50, mil_k: 7000 + i, num: 200000 + i, usd: 90 + i * 0.1, range: i < 20 ? 3.75 : 3.5 })[ind.kind] ?? 3.5 + (i % 3) * 0.1;
    out.push({ date, value: v });
    const t = d(date); if (ind.freq === "m") t.setUTCMonth(t.getUTCMonth() - 1); else if (ind.freq === "q") t.setUTCMonth(t.getUTCMonth() - 3); else t.setUTCDate(t.getUTCDate() - step);
    date = iso(t);
  }
  return out;
}
async function collectIndicators(cfg, prev, ctx) {
  const indicators = JSON.parse(JSON.stringify(prev.indicators)), errors = [];
  let ok = 0;
  for (const ind of cfg.indicators) {
    const base = prev.indicators[ind.id];
    if (!base && !(ind.group && ind.name)) { errors.push(`${ind.id}: unknown indicator (add group and name to create it)`); continue; }
    try {
      const obs = MOCK ? mockObs(ind) : await withTimeout(ind.get(ctx), 90000, "fetch");
      const obs2 = ind.get2 ? (MOCK ? mockObs({ ...ind, kind: "pct" }).map(o => ({ ...o, value: o.value + 0.25 })) : await ind.get2(ctx)) : null;
      const c = computeIndicator(ind, obs, obs2, TODAY);
      if (!c) throw new Error("no usable observations");
      const unchanged = base && base.latest_date === c.latest_date;
      indicators[ind.id] = {
        ...(base || { group: ind.group, source: ind.source, url: ind.url }), id: ind.id, name: ind.name || base.name,
        ...(ind.source ? { source: ind.source } : {}), ...(ind.url ? { url: ind.url } : {}),
        value: c.value, period: c.period, previous: c.previous, latest_date: c.latest_date, raw: c.raw,
        released: c.released || (unchanged && base.released && !base.manual ? base.released : unchanged && base.manual ? base.released : `Detected ${longDate(TODAY)}`),
        tag: ind.tag || c.tag, manual: false, estimate: !!ind.estimate, note: ind.note || undefined,
      };
      ok++;
    } catch (e) {
      errors.push(`${ind.id}: ${e.message}`);
      if (base && !base.manual) indicators[ind.id] = { ...base, tag: "old", note: "Could not refresh today; showing last collected value." };
    }
  }
  return { indicators, errors, ok };
}

// ---------------------------------------------------------------- meetings and report dates
function meetingInfo(cfg, prev) {
  const up = (cfg.meetings || []).filter(m => m.end >= TODAY);
  const fmt = m => m && { start: m.start, end: m.end, label: m.label, decision_label: m.decision_label, time_label: m.time_label || (m.decision_label.match(/\d{1,2}:\d{2} ?[ap]\.m\..*$/) || [""])[0].replace(/\s*\(when.*$/, "") };
  if (!up.length) return { ...prev.meeting, calendar_stale: true };
  return { next: fmt(up[0]), after: fmt(up[1]), calendar_url: cfg.calendar_url || prev.meeting.calendar_url, calendar_label: cfg.calendar_label || prev.meeting.calendar_label, who: prev.meeting.who, days_to_decision: daysBetween(TODAY, up[0].end) };
}
async function collectReleases(cfg, prev, meeting, ctx) {
  const horizon = addDays(TODAY, 75);
  let list = [], errors = [];
  if (cfg.releases && cfg.releases.length) list = cfg.releases.map(r => ({ ...r }));
  else if (cfg.fred_releases && !MOCK && process.env.FRED_API_KEY) {
    for (const r of cfg.fred_releases) {
      try {
        const rel = await ctx.getJson(`https://api.stlouisfed.org/fred/series/release?${new URLSearchParams({ series_id: r.series, api_key: process.env.FRED_API_KEY, file_type: "json" })}`);
        const rid = rel.releases && rel.releases[0] && rel.releases[0].id; if (!rid) throw new Error("no release id");
        const dates = await ctx.getJson(`https://api.stlouisfed.org/fred/release/dates?${new URLSearchParams({ release_id: rid, api_key: process.env.FRED_API_KEY, file_type: "json", realtime_start: TODAY, realtime_end: "9999-12-31", include_release_dates_with_no_data: "true", sort_order: "asc", limit: "30" })}`);
        let ds = (dates.release_dates || []).map(x => x.date).filter(x => x >= TODAY && x <= horizon);
        if (r.weekly) ds = ds.slice(0, 1);
        for (const dt of ds) list.push({ id: r.id, name: r.name, publisher: r.publisher, date: dt, date_label: `${weekday(dt)} ${MONTHS[d(dt).getUTCMonth()]} ${d(dt).getUTCDate()}`, time: r.time, url: r.url, what: r.what, weekly: !!r.weekly });
        await sleep(250);
      } catch (e) { errors.push(`${r.id}: ${e.message}`); }
    }
  }
  if (!list.length) list = (prev.releases || []).map(r => ({ ...r })); // keep the snapshot's list; stale dates are dropped below
  const start = meeting.next ? meeting.next.start : null, end = meeting.next ? meeting.next.end : null;
  list = list.filter(r => r.date >= TODAY && r.date <= horizon).map(r => r.approx ? r : { ...r, timing: start && r.date < start ? "before" : end && r.date > end ? "after" : start ? "day" : "after" });
  list.sort((a, b) => a.date.localeCompare(b.date));
  return { list, errors };
}

// ---------------------------------------------------------------- what changed since the last update
const firstNum = v => { const m = String(v || "").replace(/[−–]/g, "-").replace(/,/g, "").match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
function detectChanges(cfg, prev, indicators, sources) {
  const data = [], market = [], byId = Object.fromEntries(cfg.indicators.map(i => [i.id, i]));
  for (const id in indicators) {
    const cur = indicators[id], old = prev.indicators[id], ind = byId[id];
    if (!ind || !old || old.manual || cur.manual || cur.tag === "nc" || cur.note) continue; // first automatic reading is not a "change"
    const item = { id, name: cur.name, from: old.value, from_period: old.period, to: cur.value, to_period: cur.period };
    if (ind.freq === "d" && ind.kind !== "range") {
      const a = firstNum(old.value), b = firstNum(cur.value);
      if (a == null || b == null) continue;
      const big = ind.kind === "usd" || ind.kind === "level" ? Math.abs(b / a - 1) >= 0.03 : Math.abs(b - a) >= 0.05;
      if (big) market.push({ ...item, move: ind.kind === "usd" || ind.kind === "level" ? `${((b / a - 1) * 100).toFixed(1)}%` : `${b - a >= 0 ? "+" : "−"}${Math.abs(b - a).toFixed(2)} pts` });
    } else if (ind.kind === "range" || ind.kind === "proj") { if (old.value !== cur.value) data.push(item); }
    else if (old.latest_date !== cur.latest_date || old.value !== cur.value) data.push(item);
  }
  const firstRead = !(prev.qa && prev.qa.sources_read);
  const seen = new Set([...((prev.qa && prev.qa.sources_read) || []).map(x => x.url), ...((prev.changelog || []).flatMap(c => (c.fed || []).map(f => f.url)))]);
  const fed = firstRead ? [] : sources.filter(s => s.url && !seen.has(s.url)).map(s => ({ title: s.title, date: s.date, url: s.url }));
  return { data, market, fed, since: prev.asof_date, since_label: prev.asof_label };
}
function autoSummary(ch, verdictChange) {
  const items = [];
  for (const c of ch.data) items.push(`<strong>${c.name}</strong>: now ${c.to}, for ${c.to_period}. Before: ${c.from}, for ${c.from_period}.`);
  for (const c of ch.market) items.push(`<strong>${c.name}</strong> moved ${c.move}: now ${c.to}, was ${c.from}.`);
  for (const f of ch.fed) items.push(`New official item: <a href="${f.url}">${f.title}</a> (${f.date}).`);
  if (verdictChange) items.push(`<strong>Our verdict changed</strong>: ${verdictChange.from_text} → ${verdictChange.to_text}.`);
  return { headline: items.length ? "Here is what is new since the last update." : "No important new data since the last update.", items };
}

// ---------------------------------------------------------------- KPI tiles and overview card
const cleanVal = v => String(v || "—").replace(" vs a year ago", "").replace(/^\+/, "");
const shortPeriod = p => String(p || "").replace(/\s*\(.*$/, "").replace(/^In effect /, "").replace(/,? ?\d{4}$/, "").replace(/ \d{4}$/, "").replace(/Week ending /, "").trim();
function kpiTiles(cfg, indicators, prev) {
  if (!cfg.kpis || cfg.kpis.length !== 4 || cfg.kpis.some(k => !indicators[k.id])) return prev.kpis || [];
  return cfg.kpis.map(k => { const x = indicators[k.id]; return { label: k.label, value: cleanVal(x.value), note: k.note || "", period: x.period.replace(/\s*\(.*$/, ""), source: x.source, url: x.url }; });
}
function overviewBlock(cfg, prev, indicators, narrative, meeting) {
  const o = { ...prev.overview, last_move: narrative.verdict.last_move || prev.overview.last_move, card_why: narrative.verdict.card_why || prev.overview.card_why };
  const m = cfg.overview || {};
  if (m.rate && indicators[m.rate.id]) o.rate = cleanVal(indicators[m.rate.id].value).replace(" – ", "–");
  const mini = { ...o.mini };
  for (const [key, dest] of [["prices", "prices"], ["jobless", "jobless"], ["tenyr", "10-yr"]]) {
    const s = m[key], x = s && indicators[s.id];
    if (x && !x.manual) mini[dest] = [cleanVal(x.value), key === "prices" ? `${s.label}, ${shortPeriod(x.period)}` : shortPeriod(x.period)]; // cards are narrow: only the price tile names its measure
  }
  o.mini = mini;
  if (meeting.next) o.time_label = meeting.next.time_label || prev.overview.time_label;
  return o;
}

// ---------------------------------------------------------------- one country
async function updateCountry(code) {
  const prev = await readJson(path.join(DATA, `${code}.json`)).catch(() => { throw new Error(`no data/${code}.json: run scripts/tools/build-seed.mjs once`); });
  const cfg = (await import(pathToFileURL(path.join(__dirname, "countries", `${code}.mjs`)).href)).default;
  const ctx = makeCtx({ today: TODAY });
  const C = prev.country;
  log(`── ${C.name} (${code})`);

  const { indicators, errors: indErr, ok } = await collectIndicators(cfg, prev, ctx);
  const automated = cfg.indicators.length;
  log(`${code}: indicators refreshed ${ok}/${automated}`);
  if (automated >= 4 && ok < automated / 2 && !MOCK) throw new Error(`only ${ok} of ${automated} indicators could be refreshed (${indErr[0] || "?"}); keeping the previous page unchanged`);
  const meeting = meetingInfo(cfg, prev);
  const { list: releases, errors: relErr } = await collectReleases(cfg, prev, meeting, ctx);
  const { sources, errors: newsErr } = await collectNews(cfg);
  const changes = detectChanges(cfg, prev, indicators, sources);
  log(`${code}: releases ${releases.length}, official items ${sources.length}; changes: ${changes.data.length} data, ${changes.market.length} market, ${changes.fed.length} new official items`);

  // The groups list gains any new indicator the country module defines.
  const groups = prev.groups.map(g => ({ ...g, indicator_ids: [...g.indicator_ids, ...Object.keys(indicators).filter(id => indicators[id].group === g.id && !g.indicator_ids.includes(id))] }));
  let narrative = prev.narrative, narrativeUpdated = prev.narrative_updated_at, stale = !!prev.narrative_stale, aiErrors = [], model = prev.narrative_model;
  const age = prev.narrative_updated_at ? daysBetween(prev.narrative_updated_at.slice(0, 10), TODAY) : 999;
  const wantAI = process.env.FORCE_AI === "1" || changes.data.length || changes.market.length || changes.fed.length || age >= NARRATIVE_MAX_AGE_DAYS || prev.narrative_stale || (meeting.days_to_decision ?? 9) <= 1;
  let ranAI = false;

  if (wantAI && (MOCK || AI_KEY)) {
    ranAI = true;
    const system = (await fs.readFile(PROMPT, "utf8")).replace("{{COUNTRY}}", C.name).replace("{{BANK}}", C.bank).replace(/\{\{ABBREV\}\}/g, C.abbrev).replace("{{NOTES}}", cfg.prompt_notes ? "\n" + cfg.prompt_notes : "");
    const ctxV = { indicators: Object.fromEntries(Object.entries(indicators).filter(([, v]) => v.group !== "said")), sources, quoteBank: prev.quote_bank || [], domains: cfg.allowed_domains };
    const facts = {
      today: TODAY, today_label: longDate(TODAY), country: { name: C.name, bank: C.bank, abbrev: C.abbrev }, allowed_domains: cfg.allowed_domains,
      meetings: { next: meeting.next, after: meeting.after }, calendar_url: meeting.calendar_url,
      indicators: Object.fromEntries(Object.entries(ctxV.indicators).map(([k, v]) => [k, { name: v.name, value: v.value, period: v.period, released: v.released, previous: v.previous, status: v.manual ? "manual" : v.tag, source: v.source, raw: v.raw }])),
      upcoming_reports: releases.map(r => ({ id: r.id, name: r.name, date: r.date, date_label: r.date_label, timing_vs_next_decision: r.timing })),
      official_sources: sources.map(s => ({ id: s.id, title: s.title, date: s.date, url: s.url, text: s.text })),
      changes_since_last_update: { since: changes.since, new_data: changes.data, market_moves: changes.market, new_official_items: changes.fed, previous_verdict: { most_likely: prev.narrative.verdict.most_likely, probabilities: prev.narrative.verdict.probabilities } },
    };
    let feedback = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        let cand;
        if (MOCK_AI) {
          cand = JSON.parse(JSON.stringify(prev.narrative));
          if (process.env.MOCK_BAD_AI === "1") { cand.verdict.probabilities = { hold: 70, raise: 40, cut: 5 }; cand.why_steps[0].html += " The chair said “we will cut rates in a big way next month.”"; }
        } else {
          const user = `FACTS (the only numbers you may use):\n${JSON.stringify(facts)}\n\nPREVIOUS VERSION OF THE PAGE TEXT (update it, keep what is still true):\n${JSON.stringify(prev.narrative)}\n${feedback}\nReturn ONLY the JSON object.`;
          cand = extractJson(await callAI(system, user));
        }
        const { errors, quotes } = validate(cand, ctxV);
        if (errors.length) { aiErrors = errors; feedback = `\nYOUR PREVIOUS ANSWER WAS REJECTED FOR THESE REASONS. FIX ALL OF THEM:\n- ${errors.join("\n- ")}\n`; warn(`${code}: AI attempt ${attempt} rejected:\n - ${errors.join("\n - ")}`); continue; }
        narrative = normalize(cand, cfg.allowed_domains, prev.narrative.verdict.labels);
        narrativeUpdated = new Date().toISOString(); stale = false; aiErrors = []; model = MOCK_AI ? "mock" : MODEL_LABEL;
        prev.quote_bank = Array.from(new Set([...(prev.quote_bank || []), ...quotes])).slice(-400);
        break;
      } catch (e) { aiErrors = [String(e.message || e)]; warn(`${code}: AI attempt ${attempt} failed: ${e.message}`); }
    }
    if (aiErrors.length) stale = true;
  } else if (wantAI) warn(`${code}: no AI key (GEMINI_API_KEY): numbers updated, explanations kept from the previous version.`);

  // Every indicator needs an explanation block; reuse the previous one if the AI skipped it.
  narrative = { ...narrative, indicators: { ...narrative.indicators } };
  for (const id in indicators) if (indicators[id].group !== "said" && !narrative.indicators[id]) narrative.indicators[id] = (prev.narrative.indicators || {})[id] || { now_label: "See value", now_tone: "info", what: "Explanation not written yet.", why: "" };

  // Did our verdict or chances change?
  const pv = prev.narrative.verdict, nv = narrative.verdict;
  const vtxt = v => `${v.headline} (hold ${v.probabilities.hold}% / raise ${v.probabilities.raise}% / cut ${v.probabilities.cut}%)`;
  const verdictChange = ["hold", "raise", "cut"].some(o => pv.probabilities[o] !== nv.probabilities[o]) ? { from_text: vtxt(pv), to_text: vtxt(nv) } : null;
  const anything = changes.data.length || changes.market.length || changes.fed.length || verdictChange;
  const aiSummaryOk = ranAI && !stale && JSON.stringify(narrative.what_changed) !== JSON.stringify(prev.narrative.what_changed) && Array.isArray(narrative.what_changed.items);
  const summary = aiSummaryOk ? narrative.what_changed : autoSummary(changes, verdictChange);
  let changelog = prev.changelog || [];
  if (anything) changelog = [{ date: TODAY, date_label: longDate(TODAY), since: changes.since, since_label: changes.since_label, summary, data: changes.data, market: changes.market, fed: changes.fed, verdict: verdictChange, ai_written: aiSummaryOk }, ...changelog.filter(c => c.date !== TODAY)].slice(0, 30);
  narrative.what_changed = summary;

  const manualCount = Object.values(indicators).filter(i => i.manual).length;
  const out = {
    ...prev, schema: 2, asof_date: TODAY, asof_label: longDate(TODAY), generated_at: new Date().toISOString(),
    data_updated_at: new Date().toISOString(), narrative_updated_at: narrativeUpdated, narrative_stale: stale, narrative_model: model,
    meeting, kpis: kpiTiles(cfg, indicators, prev), groups, indicators, releases, narrative, changelog,
    overview: overviewBlock(cfg, prev, indicators, narrative, meeting), quote_bank: prev.quote_bank || [],
    qa: { data_errors: [...indErr, ...relErr, ...newsErr], ai_errors: aiErrors, sources_read: sources.map(s => ({ title: s.title, date: s.date, url: s.url })), coverage: { automatic: Object.keys(indicators).length - manualCount, manual: manualCount }, ai_ran: ranAI },
  };
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, `${code}.json`), JSON.stringify(out, null, 1));
  log(`${code}: wrote ${code}.json; explanations ${ranAI ? (stale ? "KEPT FROM PREVIOUS (rewrite not accepted)" : "rewritten") : "kept (nothing changed)"}`);
  return { code, ranAI };
}

// ---------------------------------------------------------------- overview page data
const NUM = /\d[\d,.]*/g;
async function buildOverview(codes, rewritten) {
  const prevOv = await readJson(path.join(DATA, "overview.json")).catch(() => null);
  const countries = [];
  for (const c of ORDER) {
    const j = await readJson(path.join(OUT_DIR, `${c}.json`)).catch(() => readJson(path.join(DATA, `${c}.json`))).catch(() => null);
    if (!j) continue;
    const v = j.narrative.verdict, o = j.overview, m = j.meeting;
    countries.push({ code: c, short: o.short, country: o.country, bank: o.bank, abbrev: o.abbrev, rate: o.rate, last_move: o.last_move, why: o.card_why, mini: o.mini,
      call: v.most_likely, headline: v.headline, probabilities: v.probabilities, confidence: v.confidence,
      next_end: m.next && m.next.end, next_label: m.next && `${weekday(m.next.end)} ${MONTHS[d(m.next.end).getUTCMonth()]} ${d(m.next.end).getUTCDate()}`, time_label: o.time_label,
      stale: !!j.narrative_stale, asof: j.asof_label, coverage: j.qa && j.qa.coverage });
  }
  countries.sort((a, b) => (a.next_end || "9").localeCompare(b.next_end || "9"));
  const calls = countries.reduce((a, c) => (a[c.call] = (a[c.call] || 0) + 1, a), {});
  const names = { hold: "Hold", raise: "Raise", cut: "Cut" };
  const headline = Object.entries(calls).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${names[k]} at ${n} of ${countries.length}`).join(" · ");
  let paragraph = prevOv && prevOv.paragraph;
  if ((rewritten.length || !paragraph) && (AI_KEY || MOCK_AI) && !MOCK) {
    const facts = countries.map(c => ({ country: c.country, bank: c.abbrev, rate: c.rate, call: c.call, probabilities: c.probabilities, confidence: c.confidence, decision: c.next_label, reason: c.why }));
    const sys = `You write the 3-sentence introduction of the overview page of a public central-bank briefing (Quant Flow Capital). Plain, calm, everyday English; no advice; never say "guaranteed" or "certain". Use ONLY numbers that appear in FACTS (counts of countries are fine). Say what the eight central banks have in common right now, and which one stands out. Return JSON: {"paragraph": "..."}`;
    for (let i = 0; i < 2; i++) {
      try {
        const p = extractJson(await callAI(sys, `FACTS:\n${JSON.stringify(facts)}`)).paragraph;
        const allowed = new Set(JSON.stringify(facts).match(NUM) || []);
        const bad = (p.match(NUM) || []).filter(n => !allowed.has(n) && !["1", "2", "3", "4", "5", "6", "7", "8"].includes(n));
        if (typeof p === "string" && p.length > 40 && !bad.length && !/guarantee|certain to|definitely/i.test(p)) { paragraph = p.replace(/<[^>]+>/g, ""); break; }
        warn(`overview paragraph rejected (${bad.join(", ") || "style"})`);
      } catch (e) { warn(`overview paragraph failed: ${e.message}`); }
    }
  }
  const ov = { generated_at: new Date().toISOString(), asof_label: longDate(TODAY), headline, paragraph: paragraph || null, window: [countries[0] && countries[0].next_end, countries[countries.length - 1] && countries[countries.length - 1].next_end], countries };
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUT_DIR, "overview.json"), JSON.stringify(ov, null, 1));
  log(`wrote overview.json (${headline})`);
}

async function main() {
  const want = (process.argv.slice(2).join(",") || process.env.COUNTRIES || "").split(/[ ,]+/).filter(Boolean);
  const codes = want.length ? ORDER.filter(c => want.includes(c)) : ORDER;
  log(`Run date (ET): ${TODAY}${MOCK ? " [MOCK MODE]" : ""} · AI: ${MOCK_AI ? "mock" : PROVIDER ? MODEL_LABEL : "none"} · countries: ${codes.join(", ")}`);
  if (!MOCK && !process.env.FRED_API_KEY) warn("FRED_API_KEY is not set: US numbers cannot be refreshed (the US page keeps its previous numbers).");
  const done = [], failed = [];
  for (const c of codes) {
    try { done.push(await updateCountry(c)); } catch (e) { failed.push(c); console.error(`[monitor] ${c} NOT UPDATED: ${e.message}`); }
    if (!MOCK) await sleep(3000);
  }
  if (MOCK || DRY) { try { for (const c of ORDER) if (!codes.includes(c)) await fs.copyFile(path.join(DATA, `${c}.json`), path.join(OUT_DIR, `${c}.json`)); } catch {} }
  await buildOverview(codes, done.filter(x => x.ranAI).map(x => x.code));
  log(`finished: ${done.length} updated, ${failed.length} skipped${failed.length ? " (" + failed.join(", ") + ")" : ""}`);
  if (!done.length) process.exitCode = 1; // nothing worked at all: make the GitHub run fail visibly, and publish nothing
}
main().catch(e => { console.error("[monitor] FAILED:", e.message); process.exit(1); });
