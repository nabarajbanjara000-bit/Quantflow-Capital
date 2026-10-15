#!/usr/bin/env node
// Live check of one country's data connections.   node scripts/tools/check-country.mjs uk
// Calls every automated indicator, the news feeds and the calendar, and prints what the page would show next to the hand-checked snapshot.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeCtx } from "../lib/sources.mjs";
import { computeIndicator, daysBetween, iso } from "../lib/indicators.mjs";
import { getText } from "../lib/http.mjs";

const code = process.argv[2];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const seed = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "monitor", "data", `${code}.json`), "utf8"));
const cfg = (await import(pathToFileURL(path.join(ROOT, "scripts", "countries", `${code}.mjs`)).href)).default;
const today = process.env.MONITOR_TODAY || iso(new Date());
const ctx = makeCtx({ today });
const problems = [];
const bad = m => { problems.push(m); console.log("  PROBLEM:", m); };

console.log(`\n== ${code}: ${cfg.indicators.length} automated of ${Object.keys(seed.indicators).length} indicators ==`);
let ok = 0;
for (const ind of cfg.indicators) {
  const s = seed.indicators[ind.id];
  if (!s && !ind.group) { bad(`${ind.id}: not in the snapshot (add group/name to add a new indicator)`); continue; }
  try {
    const obs = await Promise.race([ind.get(ctx), new Promise((_, r) => setTimeout(() => r(new Error("timeout 60s")), 60000))]);
    const c = computeIndicator(ind, obs, null, today);
    if (!c) throw new Error("no usable observations");
    if (!c.tag) throw new Error("no tag");
    ok++;
    console.log(`  ok  ${ind.id.padEnd(34)} ${c.value} | ${c.period} | rel ${c.released || "-"}  [snapshot: ${s ? s.value + " | " + s.period : "new"}]`);
    if (obs.length < (ind.kind.startsWith("yoy") || ind.kind === "mom_yoy" ? 14 : 2)) bad(`${ind.id}: only ${obs.length} observations returned`);
  } catch (e) { bad(`${ind.id}: ${e.message}`); }
}
console.log(`indicators working: ${ok}/${cfg.indicators.length}`);

for (const f of cfg.feeds || []) {
  try { const t = await getText(f.url, { tries: 2 }); const n = (t.match(/<item[ >]|<entry[ >]/g) || []).length; console.log(`  feed ${f.id}: ${n} items`); if (!n) bad(`feed ${f.id}: 0 items`); }
  catch (e) { bad(`feed ${f.id}: ${e.message}`); }
}
const up = (cfg.meetings || []).filter(m => m.end >= today);
console.log(`meetings upcoming: ${up.map(m => m.end).join(", ")}`);
if (up.length < 2) bad("need at least the next 2 meetings");
for (const k of cfg.kpis || []) if (!seed.indicators[k.id]) bad(`kpi ${k.id} not an indicator`);
for (const k of ["rate", "prices", "jobless", "tenyr"]) if (!cfg.overview?.[k] || !seed.indicators[cfg.overview[k].id]) bad(`overview.${k} missing/unknown`);
const rel = (cfg.releases || []).filter(r => r.date >= today);
console.log(`releases upcoming: ${rel.length}`);
if (rel.length < 4) bad("fewer than 4 upcoming releases listed");
console.log(problems.length ? `\n${problems.length} problem(s)` : "\nALL GOOD");
