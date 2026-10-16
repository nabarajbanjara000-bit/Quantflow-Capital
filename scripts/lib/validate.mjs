// Safety checks on AI-written text. A rewrite that fails is rejected (one retry, then the previous text is kept).
const OPTIONS = ["hold", "raise", "cut"];
export const BANNED = [/\bguarantee(d)?\b/i, /\bcertain to\b/i, /\bwill definitely\b/i, /\brisk[- ]free\b/i, /\bwe recommend (buying|selling)\b/i, /\byou should (buy|sell)\b/i];

export const normQ = s => s.toLowerCase().replace(/[“”"«»]/g, "").replace(/[’‘`]/g, "'").replace(/[–—]/g, "-").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
export function allStrings(o, acc = []) { if (typeof o === "string") acc.push(o); else if (Array.isArray(o)) o.forEach(x => allStrings(x, acc)); else if (o && typeof o === "object") Object.values(o).forEach(x => allStrings(x, acc)); return acc; }
export function quotesIn(s) { const out = []; const t = s.replace(/<[^>]+>/g, ""); for (const m of t.matchAll(/[“"]([^”"]{15,400})[”"]/g)) out.push(m[1].trim()); return out; }
export const domainOk = (u, domains) => { try { const h = new URL(u).hostname.replace(/^www\./, ""); return domains.some(dm => h === dm || h.endsWith("." + dm)); } catch { return false; } };

// Only these tags survive in AI text; links must be https and on an official domain.
export function scrubLinks(s, domains) {
  return s.replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (m, href, inner) => (href.startsWith("https://") && domainOk(href, domains)) ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${inner}</a>` : inner)
          .replace(/<(?!\/?(strong|em|b|i|a|br|ul|li)\b)[^>]*>/gi, "");
}
export function deepMap(o, f) { if (typeof o === "string") return f(o); if (Array.isArray(o)) return o.map(x => deepMap(x, f)); if (o && typeof o === "object") { const r = {}; for (const k in o) r[k] = deepMap(o[k], f); return r; } return o; }

// ctx: { indicators, sources, quoteBank, domains }
export function validate(n, ctx) {
  const errors = [];
  const req = ["what_changed", "verdict", "why_steps", "timeline", "choices", "change", "report_card", "indicators", "said", "gaps", "group_intros"];
  for (const k of req) if (!(k in (n || {}))) errors.push(`missing field: ${k}`);
  if (errors.length) return { errors };
  const v = n.verdict, p = v.probabilities || {};
  const probs = OPTIONS.map(o => p[o]);
  if (probs.some(x => !Number.isInteger(x) || x < 0 || x > 100)) errors.push("probabilities must be whole numbers 0–100");
  else if (probs.reduce((a, b) => a + b, 0) !== 100) errors.push(`probabilities add to ${probs.reduce((a, b) => a + b, 0)}, not 100`);
  else {
    const max = Math.max(...probs);
    if (p[v.most_likely] !== max) errors.push("most_likely is not the option with the highest probability");
    if (probs.filter(x => x === max).length > 1) errors.push("two options tie for most likely; pick one");
    if (max >= 95) errors.push("no option may be given 95% or more (never present a scenario as certain)");
  }
  if (!n.what_changed || !Array.isArray(n.what_changed.items)) errors.push("what_changed must have an items list");
  if (!["Low", "Medium", "High"].includes(v.confidence)) errors.push("confidence must be Low, Medium or High");
  if (typeof v.card_why !== "string" || !v.card_why || v.card_why.length > 200) errors.push("verdict.card_why must be one sentence of at most 160 characters");
  if (!Array.isArray(n.why_steps) || n.why_steps.length < 4) errors.push("why_steps needs at least 4 steps");
  else if (!n.why_steps.some(s => s.scale)) errors.push("one why_step must contain a `scale` (for and against)");
  if (!Array.isArray(n.timeline) || n.timeline.length < 6) errors.push("timeline needs at least 6 steps");
  if (!Array.isArray(n.choices) || n.choices.length !== 3 || OPTIONS.some(o => !n.choices.find(c => c.option === o))) errors.push("choices must contain hold, raise and cut exactly once");
  if (!Array.isArray(n.report_card) || n.report_card.length !== 4) errors.push("report_card needs exactly 4 areas");
  else for (const g of n.report_card) if (!["red", "amber", "green"].includes(g.grade)) errors.push(`report_card grade must be red/amber/green (got ${g.grade})`);
  if (!Array.isArray(n.said)) errors.push("said must be a list");
  const missingInd = Object.keys(ctx.indicators).filter(id => !(n.indicators || {})[id]);
  if (missingInd.length) errors.push(`indicators missing explanations: ${missingInd.join(", ")}`);
  const text = allStrings(n);
  for (const s of text) for (const b of BANNED) if (b.test(s)) errors.push(`banned wording: "${s.match(b)[0]}"`);
  // Every quotation must be found word-for-word in an official source we gave the model, or in the bank of quotes verified earlier.
  const corpus = normQ([...ctx.sources.map(s => s.text + " " + s.title), ...ctx.quoteBank].join(" \n "));
  const bad = [];
  for (const s of text) for (const q of quotesIn(s)) if (!corpus.includes(normQ(q))) bad.push(q);
  if (bad.length) errors.push(`quotes not found in official sources (remove or fix them): ${bad.slice(0, 6).map(q => `“${q}”`).join(" | ")}`);
  return { errors, quotes: text.flatMap(quotesIn) };
}

export function normalize(n, domains, prevLabels) {
  // Make choices agree with the verdict and sort them most -> least likely.
  const p = n.verdict.probabilities;
  n.choices.forEach(c => { c.prob = p[c.option]; });
  n.choices.sort((a, b) => b.prob - a.prob);
  if (!n.verdict.labels) n.verdict.labels = prevLabels;
  n.said = (n.said || []).filter(r => r && r.n && Array.isArray(r.now) && Array.isArray(r.w));
  return deepMap(n, s => scrubLinks(s, domains));
}
