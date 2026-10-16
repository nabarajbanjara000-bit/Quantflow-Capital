/* Global Central Bank Monitor: draws the page from data/*.json. Plain JavaScript, no libraries, no keys.
   overview.json  -> the overview panel (cards, calendar, comparison table)
   <code>.json    -> one country panel, loaded the first time its tab is opened.
   The data files are rewritten every day by scripts/update.mjs (GitHub Action). */
(function () {
"use strict";
if (window.parent !== window) document.documentElement.classList.add("embedded"); // shown inside the homepage frame: the homepage supplies the header
var CODES = ["us", "japan", "germany", "canada", "newzealand", "australia", "switzerland", "uk"];
var BASE = "data/";
var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
var ARROW = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
var CAP = { hold: "Hold", raise: "Raise", cut: "Cut" };

/* ---------- helpers ---------- */
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]; }); }
function okUrl(u) { try { var x = new URL(u, window.location.href); return x.protocol === "https:" || x.protocol === "http:"; } catch (e) { return false; } } // domains are checked by the daily job
// Safe rich text: only strong/em/b/i/br/ul/li and https/http links survive.
function rich(s) {
  var doc = new DOMParser().parseFromString("<div>" + String(s == null ? "" : s) + "</div>", "text/html");
  function walk(n) {
    var out = "";
    n.childNodes.forEach(function (c) {
      if (c.nodeType === 3) { out += esc(c.nodeValue); return; }
      if (c.nodeType !== 1) return;
      var t = c.tagName.toLowerCase(), inner = walk(c);
      if (t === "strong" || t === "b") out += "<strong>" + inner + "</strong>";
      else if (t === "em" || t === "i") out += "<em>" + inner + "</em>";
      else if (t === "br") out += "<br>";
      else if (t === "ul") out += "<ul>" + inner + "</ul>";
      else if (t === "li") out += "<li>" + inner + "</li>";
      else if (t === "a") {
        var h = c.getAttribute("href") || "";
        if (okUrl(h)) out += '<a href="' + esc(h) + '" target="_blank" rel="noopener noreferrer">' + inner + "</a>";
        else if (h.charAt(0) === "#") out += '<a href="' + esc(h) + '">' + inner + "</a>";
        else out += inner;
      }
      else out += inner;
    });
    return out;
  }
  return walk(doc.body.firstChild);
}
function paras(s) { return String(s || "").split(/\n\s*\n/).map(function (p) { p = p.trim(); return /^<ul>/i.test(p) ? rich(p) : "<p>" + rich(p) + "</p>"; }).join(""); }
function para(s) { return rich(s).replace(/^(What it is:|Why it matters:|What it said:|What he said:|What she said:|What they said:)/, "<strong>$1</strong>"); }
function link(label, url) { return okUrl(url) ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + "</a>" : esc(label); }
function when(iso) { if (!iso) return "—"; return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }); }
function dt(iso) { return new Date(iso + "T12:00:00Z"); }
function dShort(iso) { var t = dt(iso); return MONTHS[t.getUTCMonth()] + " " + t.getUTCDate(); }
function secHead(n, id, title) { return '<div class="sec-head"><span class="sec-num">' + n + '</span><h2 id="' + id + '-h">' + esc(title) + "</h2></div>"; }
function getJson(name) { return fetch(BASE + name, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }); }
var TAG = { official: ["Official", "t-official"], secondary: ["Secondary", "t-secondary"], old: ["Old", "t-old"], nc: ["Not collected", "t-nc"] };
var TONE_OK = { bad: 1, mixed: 1, good: 1, info: 1 };
function cleanVal(v) { return String(v || "—").replace(" vs a year ago", "").replace(/^\+/, ""); }

/* ---------- overview panel ---------- */
function renderOverview(ov) {
  var C = ov.countries, w = ov.window || [];
  var asof = dt(ov.asof_iso || new Date().toISOString().slice(0, 10));
  var h = '<section class="intro" aria-labelledby="page-title"><div><span class="eyebrow">Macro Research · Central Bank Watch</span><h1 id="page-title">Global Central Bank Monitor</h1>' +
    '<p class="intro-lede">Eight major central banks decide on interest rates between ' + (w[0] ? dShort(w[0]) : "—") + " and " + (w[1] ? dShort(w[1]) : "—") +
    ". This briefing explains, in everyday language and with the same step-by-step method for every country, what each one is dealing with and what it will most likely do: the U.S. Federal Reserve, the Bank of Japan, the European Central Bank (which sets Germany's rate), the Bank of Canada, the Reserve Bank of New Zealand, the Reserve Bank of Australia, the Swiss National Bank and the Bank of England.</p></div>" +
    '<dl class="intro-stats" style="margin:0"><div><span>As of</span><b>' + esc(ov.asof_label) + '</b></div><div><span>Decision window</span><b>' + (w[0] ? dShort(w[0]) + " – " + dShort(w[1]) : "—") + '</b></div>' +
    '<div><span>Banks covered</span><b>' + C.map(function (c) { return esc(c.abbrev); }).join(" · ") + '</b></div><div class="hl"><span>Our base case</span><b>' + esc(ov.headline) + "</b></div></dl></section>";
  h += '<section class="block" id="overview" aria-labelledby="overview-h"><div class="sec-head"><span class="sec-num ov">At a glance</span><h2 id="overview-h">Eight decisions, one picture</h2></div>';
  if (ov.paragraph) h += '<p class="sec-intro">' + esc(ov.paragraph) + ' <span class="kind forecast">Forecast · our judgement</span></p>';
  h += '<div class="cb-grid">';
  C.forEach(function (c) {
    var p = c.probabilities, mini = c.mini || {};
    h += '<article class="cb-card"><div class="cb-top"><span class="cb-code">' + esc(c.short) + "</span><div><b>" + esc(c.country) + "</b><small>" + esc(c.bank) + "</small></div></div>" +
      '<div class="cb-rate"><span>Policy rate</span><b>' + esc(c.rate) + "</b><small>" + esc(c.last_move) + "</small></div>" +
      '<div class="cb-call"><span>Next decision · ' + esc(c.next_label) + "</span><b>" + esc(CAP[c.call]) + '</b><em class="conf">' + esc(c.confidence) + " confidence</em></div>" +
      '<div class="stack" role="img" aria-label="Hold ' + p.hold + "%, Raise " + p.raise + "%, Cut " + p.cut + '%"><span class="s-hold" style="width:' + p.hold + '%"></span><span class="s-raise" style="width:' + p.raise + '%"></span><span class="s-cut" style="width:' + p.cut + '%"></span></div>' +
      '<div class="stack-legend"><span><i class="s-hold"></i>Hold ' + p.hold + '%</span><span><i class="s-raise"></i>Raise ' + p.raise + '%</span><span><i class="s-cut"></i>Cut ' + p.cut + "%</span></div>" +
      '<p class="cb-why">' + rich(c.why) + '</p><dl class="cb-mini">' +
      [["Prices", mini.prices], ["Jobless", mini.jobless], ["10-yr", mini["10-yr"]]].map(function (m) { var v = m[1] || ["—", ""]; return "<div><dt>" + m[0] + "</dt><dd>" + esc(v[0]) + "</dd><small>" + esc(v[1]) + "</small></div>"; }).join("") +
      '</dl><a class="cb-open" href="#' + c.code + '" data-country="' + c.code + '">Open the full ' + esc(c.abbrev) + " monitor " + ARROW + "</a></article>";
  });
  h += "</div></section>";
  // calendar
  h += '<section class="block" id="calendar" aria-labelledby="calendar-h"><div class="sec-head"><span class="sec-num ov">Decision calendar</span><h2 id="calendar-h">When each bank announces</h2></div>' +
    '<p class="sec-intro">The next decision of each bank, in order. All times are local to each bank, with the U.S. Eastern Time equivalent where it helps.</p><div class="cal">';
  var days = [];
  C.forEach(function (c) { if (!c.next_end) return; var last = days[days.length - 1]; if (last && last.d === c.next_end) last.items.push(c); else days.push({ d: c.next_end, items: [c] }); });
  days.forEach(function (day) {
    var t = dt(day.d);
    h += '<div class="cal-day"><div class="cal-date"><span>' + DAYS[t.getUTCDay()] + "</span><b>" + dShort(day.d) + "</b></div><ul>" + day.items.map(function (c) {
      return '<li><a href="#' + c.code + '" data-country="' + c.code + '"><span class="cb-code sm">' + esc(c.short) + "</span><span><b>" + esc(c.bank) + "</b><small>" + esc((c.time_label ? c.time_label + " · " : "") + "our call: " + CAP[c.call] + " (" + c.probabilities[c.call] + "%)") + "</small></span></a></li>";
    }).join("") + "</ul></div>";
  });
  h += "</div></section>";
  // comparison table
  var byCode = {}; C.forEach(function (c) { byCode[c.code] = c; });
  var ordered = CODES.map(function (k) { return byCode[k]; }).filter(Boolean);
  function pair(v) { return v ? v[0] + " (" + v[1] + ")" : "—"; }
  var rows = [["Central bank", function (c) { return c.bank; }], ["Policy rate", function (c) { return c.rate; }], ["Last move", function (c) { return c.last_move; }],
    ["Next decision", function (c) { return c.next_label + (c.time_label ? " · " + c.time_label : ""); }], ["Inflation", function (c) { return pair((c.mini || {}).prices); }],
    ["Unemployment", function (c) { return pair((c.mini || {}).jobless); }], ["10-year yield", function (c) { return pair((c.mini || {})["10-yr"]); }],
    ["Our call (Hold / Raise / Cut)", function (c) { var p = c.probabilities; return CAP[c.call] + " · " + p.hold + "% / " + p.raise + "% / " + p.cut + "%"; }], ["Confidence", function (c) { return c.confidence; }]];
  h += '<section class="block" id="compare" aria-labelledby="compare-h"><div class="sec-head"><span class="sec-num ov">Side by side</span><h2 id="compare-h">The key numbers compared</h2></div>' +
    '<p class="sec-intro">Each country measures inflation and unemployment in its own way, so compare direction and distance from target rather than exact levels. Our call shows Hold / Raise / Cut chances. Tap a country name to open its full monitor.</p>' +
    '<div class="tscroll"><table class="compare" style="min-width:1500px"><thead><tr><th scope="col">As of ' + esc(ov.asof_label) + "</th>" +
    ordered.map(function (c) { return '<th scope="col"><a href="#' + c.code + '" data-country="' + c.code + '">' + esc(c.country) + "</a></th>"; }).join("") + "</tr></thead><tbody>" +
    rows.map(function (r) { return '<tr><th scope="row">' + r[0] + "</th>" + ordered.map(function (c) { return "<td>" + esc(r[1](c)) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody></table></div>" +
    '<div class="howto" aria-label="How to read each monitor" style="margin-top:28px"><div><span class="kind fact">Fact</span><br>Something that already happened, taken from an official source. Each one has a link so you can check it yourself.</div>' +
    '<div><span class="kind analysis">Analysis</span><br>Our explanation of what the facts mean. Thoughtful people could read the same facts differently.</div>' +
    '<div><span class="kind forecast">Forecast</span><br>Our guess about the future. It can be wrong. We never present it as certain.</div></div></section>';
  return h;
}

/* ---------- country panel ---------- */
function renderCountry(D) {
  var c = D.code, K = D.country, N = D.narrative, V = N.verdict, P = V.probabilities, M = D.meeting, I = D.indicators, T = D.copy.titles, OV = D.overview;
  var h = '<div class="panel-kicker"><span>' + esc(K.kicker) + '</span><a href="#overview" data-country="overview">← Back to overview</a></div>';
  var nextShort = M.next && M.next.end ? DAYS[dt(M.next.end).getUTCDay()] + ", " + dShort(M.next.end) + (M.next.time_label ? " · " + M.next.time_label : "") : "Not scheduled";
  h += '<section class="intro" aria-labelledby="' + c + '-page-title"><div><span class="eyebrow">' + esc(K.eyebrow) + '</span><h2 class="country-title" id="' + c + '-page-title">' + esc(K.title) + '</h2><p class="intro-lede">' + esc(K.lede) + "</p>" +
    (K.currency_note ? '<p class="currency-note">' + rich(K.currency_note) + "</p>" : "") + '</div><dl class="intro-stats" style="margin:0"><div><span>As of</span><b>' + esc(DAYS[dt(D.asof_date).getUTCDay()] + ", " + dShort(D.asof_date) + ", " + D.asof_date.slice(0, 4)) + "</b></div>" +
    "<div><span>Next decision</span><b>" + esc(nextShort) + "</b></div><div><span>" + esc(K.rate_label) + "</span><b>" + esc(OV.rate) + '</b></div><div class="hl"><span>Our base case</span><b>' + esc(CAP[V.most_likely] + " (≈" + P[V.most_likely] + "%)") + "</b></div></dl></section>";

  // key figures
  h += '<div class="kpis" role="list" aria-label="Key figures">';
  if (D.kpis && D.kpis.length) D.kpis.forEach(function (k) { h += '<div class="kpi" role="listitem"><div class="k-label">' + esc(k.label) + '</div><div class="k-val">' + esc(k.value) + '</div><div class="k-note">' + (k.note ? esc(k.note) + " · " : "") + esc(k.period) + " · " + link(k.source, k.url) + "</div></div>"; });
  else D.kpis_seed.forEach(function (k) { h += '<div class="kpi" role="listitem"><div class="k-label">' + esc(k.label) + '</div><div class="k-val">' + esc(k.value) + '</div><div class="k-note">' + rich(k.note_html) + "</div></div>"; });
  h += "</div>";

  // what changed
  var CL = D.changelog || [], sm = N.what_changed || {}, c0 = CL[0];
  h += '<section class="changed" id="' + c + '-changed" aria-labelledby="' + c + '-changed-h"><div class="ch-top"><h2 id="' + c + '-changed-h">What changed' + (c0 && c0.since_label ? " since " + esc(c0.since_label) : "") + '</h2><span class="ch-date">' + (c0 ? "Update of " + esc(c0.date_label) : "Starting snapshot") + "</span></div>";
  if (c0) sm = c0.summary || sm;
  if (sm.headline) h += '<p class="ch-head">' + rich(sm.headline) + "</p>";
  if (sm.items && sm.items.length) h += '<ul class="ch-items">' + sm.items.map(function (x) { return "<li>" + rich(x) + "</li>"; }).join("") + "</ul>";
  if (c0) {
    var rowsC = (c0.data || []).concat(c0.market || []);
    if (rowsC.length) {
      h += "<details><summary>See every number that changed (" + rowsC.length + ')</summary><div class="tscroll"><table style="min-width:620px"><thead><tr><th scope="col">Indicator</th><th scope="col">Before</th><th scope="col">Now</th></tr></thead><tbody>';
      rowsC.forEach(function (r) { h += '<tr><th scope="row" style="font-weight:600">' + esc(r.name) + "</th><td>" + esc(r.from) + '<br><span class="small">' + esc(r.from_period) + "</span></td><td><strong>" + esc(r.to) + '</strong><br><span class="small">' + esc(r.to_period) + "</span></td></tr>"; });
      h += "</tbody></table></div></details>";
    }
    if ((c0.fed || []).length) h += "<details><summary>New from the central bank (" + c0.fed.length + ')</summary><ul class="clean" style="margin-top:8px">' + c0.fed.map(function (f) { return "<li>" + link(f.title, f.url) + ' <span class="small">(' + esc(f.date) + ")</span></li>"; }).join("") + "</ul></details>";
    if (CL.length > 1) {
      h += '<details><summary>Earlier updates</summary><ul class="ch-old">';
      CL.slice(1, 8).forEach(function (o) { var os = o.summary || {}; h += "<li><b>" + esc(o.date_label) + "</b> · " + rich(os.headline || "") + ((os.items || []).length ? '<ul class="clean" style="margin-top:4px">' + os.items.slice(0, 6).map(function (x) { return "<li>" + rich(x) + "</li>"; }).join("") + "</ul>" : "") + "</li>"; });
      h += "</ul></details>";
    }
  }
  if (c0) h += '<p class="small" style="margin:10px 0 0">' + ( c0.ai_written ? "Summary written by the AI from the changed numbers; the numbers themselves come straight from official data." : "Summary generated automatically from the changed numbers.") + "</p></section>";
  if (D.narrative_stale) h += '<div class="stale" role="note"><strong>Note:</strong> the numbers are fresh, but the written explanations were last updated ' + esc(when(D.narrative_updated_at)) + ". Some sentences may refer to older figures. Where the text and the numbers disagree, trust the numbers.</div>";

  // 01 verdict
  h += '<section class="block" id="' + c + '-verdict" aria-labelledby="' + c + '-verdict-h">' + secHead("01", c + "-verdict", T.verdict);
  h += '<div class="card verdict"><span class="kind forecast">Forecast · Quant Flow\'s own judgement</span><div class="vgrid"><div><div class="meeting"><dl>';
  h += "<dt>Who decides</dt><dd>" + rich(M.who) + "</dd>";
  if (M.next) h += "<dt>Meeting</dt><dd>" + esc(M.next.label) + "</dd><dt>Decision</dt><dd>" + esc(M.next.decision_label) + "</dd>";
  if (M.after) h += "<dt>Meeting after</dt><dd>" + esc(M.after.label) + "</dd>";
  h += '</dl><p class="small" style="margin:10px 0 0">' + link(M.calendar_label || "Official meeting calendar", M.calendar_url) + "</p></div>";
  h += '<div class="outcome-label">Our single most likely outcome</div><div class="big">' + esc(V.headline) + '</div><p class="big-sub">' + rich(V.sub) + "</p>";
  h += '<p>Confidence: <span class="conf">' + esc(V.confidence) + '</span></p><p class="small">' + rich(V.confidence_note) + "</p></div>";
  h += "<div><h3>" + esc(D.copy.rough_title) + '</h3><ul class="bars" aria-label="Quant Flow\'s rough chances for the next decision">';
  var L = V.labels || {};
  [["hold", "Hold (no change)", "fill-hold"], ["raise", "Raise (up)", "fill-raise"], ["cut", "Cut (down)", "fill-cut"]].forEach(function (o) {
    h += '<li><div class="bar-label"><span>' + esc(L[o[0]] || o[1]) + "</span><span>about " + P[o[0]] + '%</span></div><div class="bar-track" aria-hidden="true"><div class="bar-fill ' + o[2] + '" style="width:' + Math.max(0, Math.min(100, P[o[0]])) + '%"></div></div></li>';
  });
  h += '</ul><p class="note">' + rich(D.copy.verdict_note) + '</p><div class="plain"><span class="pl">The short version</span><p>' + rich(V.short_version) + "</p></div></div></div></div>";
  h += '<div class="card"><span class="kind analysis">Analysis</span><h3>' + esc(D.copy.why_title) + '</h3><ol class="steps">';
  N.why_steps.forEach(function (s) {
    h += "<li><h4>" + esc(s.title) + "</h4>";
    if (s.scale) h += '<div class="scale"><div class="for"><h5>' + esc(s.scale.left_title) + "</h5><ul>" + s.scale.left.map(function (x) { return "<li>" + rich(x) + "</li>"; }).join("") + '</ul></div><div class="against"><h5>' + esc(s.scale.right_title) + "</h5><ul>" + s.scale.right.map(function (x) { return "<li>" + rich(x) + "</li>"; }).join("") + "</ul></div></div>";
    if (s.html) h += paras(s.html);
    h += "</li>";
  });
  h += "</ol></div></section>";

  // 02 story
  h += '<section class="block" id="' + c + '-story" aria-labelledby="' + c + '-story-h">' + secHead("02", c + "-story", T.story);
  h += '<p class="sec-intro">' + rich(D.copy.story_intro) + '</p><span class="kind fact">Observed facts, with our plain explanation</span><ol class="timeline">';
  N.timeline.forEach(function (t) {
    var cls = { up: "up", down: "down", now: "now" }[t.kind] || "", src = t.sources || [];
    h += '<li class="' + cls + '"><div class="tbox"><div class="tdate">' + esc(t.date_label) + '</div><div class="ttitle">' + esc(t.title) + '</div><div class="tgrid">';
    h += "<div><h5>What happened</h5><p>" + rich(t.what) + "</p></div><div><h5>Why</h5><p>" + rich(t.why) + "</p></div><div><h5>What it meant for people</h5><p>" + rich(t.people) + "</p></div>";
    h += "<div><h5>" + (src.length > 1 ? "Sources" : "Source") + "</h5><p>" + src.map(function (s) { return link(s.label, s.url); }).join(" · ") + "</p></div></div>";
    if (t.because) h += '<div class="because"><b>Because of this →</b> ' + rich(t.because) + "</div>";
    h += "</div></li>";
  });
  h += "</ol></section>";

  // 03 choices
  h += '<section class="block" id="' + c + '-choices" aria-labelledby="' + c + '-choices-h">' + secHead("03", c + "-choices", T.choices);
  h += '<p class="sec-intro">' + rich(D.copy.choices_intro) + "</p>";
  N.choices.slice().sort(function (a, b) { return (P[b.option] || 0) - (P[a.option] || 0); }).forEach(function (ch, i) {
    h += '<article class="choice"><div class="choice-head"><div><span class="rank">' + esc(ch.rank_label) + "</span><h3>" + (i + 1) + ". " + esc(ch.title) + '</h3></div><span class="pct">≈' + P[ch.option] + '%</span></div><div class="choice-body">';
    h += "<p><strong>What it means:</strong> " + rich(ch.meaning) + '</p><div class="two"><div class="yes"><h4>Why it could happen</h4><ul>' + ch["for"].map(function (x) { return "<li>" + rich(x) + "</li>"; }).join("") + '</ul></div><div class="no"><h4>Why it might not</h4><ul>' + ch.against.map(function (x) { return "<li>" + rich(x) + "</li>"; }).join("") + "</ul></div></div>";
    h += '<div class="life"><b>In everyday life:</b> ' + rich(ch.everyday) + "</div></div></article>";
  });
  h += "</section>";

  // 04 what could change
  var Ch = N.change, R = Ch.reports || {};
  h += '<section class="block" id="' + c + '-change" aria-labelledby="' + c + '-change-h">' + secHead("04", c + "-change", T.change) + '<div class="card"><span class="kind analysis">Analysis · our judgement</span>';
  h += '<p class="sec-intro">' + rich(Ch.lead) + '</p><div class="plain"><span class="pl">' + esc(Ch.intro_title) + "</span><p>" + rich(Ch.intro) + "</p></div>";
  h += '<div class="tscroll"><table style="min-width:980px"><caption>' + esc(D.copy.change_caption) + "</caption><thead><tr>" + D.copy.change_head.map(function (x) { return '<th scope="col">' + esc(x) + "</th>"; }).join("") + "</tr></thead><tbody>";
  var rows = D.releases.slice(), dec = M.next && M.next.end ? { decision: true, date: M.next.end } : null;
  if (dec) { rows.push(dec); rows.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.decision ? 1 : -1); }); }
  rows.forEach(function (r) {
    if (r.decision) {
      var dr = D.copy.decision_row;
      h += '<tr><td class="when">' + esc(DAYS[dt(M.next.end).getUTCDay()] + " " + dShort(M.next.end)) + "<br>" + esc((M.next.time_label || "").replace(/\s*\(.*$/, "")) + "</td><td>" + link(dr.name, M.calendar_url) + " · " + esc(dr.publisher) + '</td><td><span class="pill p-day">Decision</span></td><td>' + rich(dr.what) + "</td><td>—</td><td>—</td></tr>";
      return;
    }
    var e = R[r.id] || {};
    var pill = r.timing === "before" ? '<span class="pill p-before">Before</span>' : r.timing === "day" ? '<span class="pill p-day">Meeting days</span>' : '<span class="pill p-after">After</span>';
    var label = r.weekly && !/^Every/.test(r.date_label) ? "Every " + DAYS_LONG[dt(r.date).getUTCDay()] : r.date_label;
    h += '<tr><td class="when">' + esc(label) + (r.time ? "<br>" + esc(r.time) : "") + "</td><td>" + link(r.name, r.url) + " · " + esc(r.publisher) + "</td><td>" + pill + "</td><td>" + rich(r.what) + "</td><td>" + rich(e.why || "—") + "</td><td>" + rich(e.trigger || "—") + "</td></tr>";
  });
  h += "</tbody></table></div>";
  if (M.calendar_stale) h += '<p class="small" style="margin-top:10px">The meeting calendar needs its yearly refresh; the dates above may be out of date.</p>';
  h += '<h3 style="margin-top:24px">' + esc(Ch.other_title) + '</h3><ul class="clean">' + Ch.other.map(function (x) { return "<li>" + rich(x) + "</li>"; }).join("") + "</ul></div></section>";

  // 05 report card
  var G = { red: ["g-red", "Red · Problem"], amber: ["g-amber", "Yellow · Mixed"], green: ["g-green", "Green · Healthy"] };
  h += '<section class="block" id="' + c + '-report" aria-labelledby="' + c + '-report-h">' + secHead("05", c + "-report", T.report) + '<p class="sec-intro">' + rich(D.copy.report_intro) + '</p><div class="grades">';
  N.report_card.forEach(function (g) {
    var k = G[g.grade] || G.amber, lab = g.change_label || (D.copy.rc_labels || {})[g.area] || "What would change it";
    h += '<article class="grade ' + k[0] + '"><div class="light"><span class="dot" aria-hidden="true"></span>' + k[1] + "</div><h3>" + esc(g.area) + '</h3><p class="one">' + rich(g.one) + "</p><dl><dt>What we look at</dt><dd>" + rich(g.look) + "</dd><dt>Why it got this color</dt><dd>" + rich(g.why) + "</dd><dt>" + esc(lab) + "</dt><dd>" + rich(g.change) + "</dd><dt>Why it matters for the decision</dt><dd>" + rich(g.matters) + "</dd></dl></article>";
  });
  h += "</div></section>";

  // 06 numbers
  h += '<section class="block" id="' + c + '-numbers" aria-labelledby="' + c + '-numbers-h">' + secHead("06", c + "-numbers", T.numbers) + '<p class="sec-intro">' + rich(D.copy.numbers_intro) + "</p>";
  h += '<div class="legend" aria-label="Status tag meanings"><span><span class="tag t-official">Official</span> from a government or central-bank source</span><span><span class="tag t-secondary">Secondary</span> from a news or private source, or reported second-hand</span><span><span class="tag t-old">Old</span> real, but out of date</span><span><span class="tag t-nc">Not collected</span> we did not get it</span></div>';
  var cov = D.qa && D.qa.coverage;
  if (cov) h += '<p class="small">Refreshed automatically every day: <strong>' + cov.automatic + "</strong> of " + (cov.automatic + cov.manual) + " numbers. The rest are hand-checked snapshots and say so on their row.</p>";
  D.groups.forEach(function (g, gi) {
    var intro = (N.group_intros || {})[g.id] || "", miss = ((D.copy.missing || {})[g.id] || []).slice();
    if (g.id === "said") {
      var rowsS = N.said || [];
      h += '<details class="group"><summary><span class="gname">' + esc(g.name) + '</span><span class="gcount">' + rowsS.length + " items</span></summary><p class=\"gintro\">" + rich(intro) + '</p><div class="inds">';
      rowsS.forEach(function (r) { h += indRow(r.n, r.v, r.p, r.r, r.pv, "official", r.s, r.u, r.now[0].replace("now-", ""), r.now[1], r.w, null); });
      h += "</div>" + missBox(miss) + "</details>";
      return;
    }
    var ids = g.indicator_ids.filter(function (id) { return I[id]; });
    h += '<details class="group"' + (gi === 0 ? " open" : "") + '><summary><span class="gname">' + esc(g.name) + '</span><span class="gcount">' + ids.length + " indicators</span></summary><p class=\"gintro\">" + rich(intro) + '</p><div class="inds">';
    ids.forEach(function (id) {
      var x = I[id], e = (N.indicators || {})[id] || {};
      if (x.tag === "nc") miss.push(x.name);
      h += indRow(x.name, x.value, x.period, x.released, x.previous, x.tag, x.source, x.url, e.now_tone, e.now_label, ["What it is: " + (e.what || ""), "Why it matters: " + (e.why || "")], x);
    });
    h += "</div>" + missBox(miss) + "</details>";
  });
  h += "</section>";

  // 07 live check (FRED)
  var B = D.copy.live_before.slice(), A = D.copy.live_after;
  B[0] = { cls: "", html: "The numbers on this page are refreshed automatically by a daily program (see the update times at the bottom of the page), and some are still hand-checked snapshots (marked on each row). If you want to check for anything newer, you can try loading values straight from <strong>FRED</strong>, a free public data service run by the Federal Reserve Bank of St. Louis.", style: "" };
  function pp(x) { return "<p" + (x.cls ? ' class="' + esc(x.cls) + '"' : "") + (x.style ? ' style="' + esc(x.style) + '"' : "") + ">" + rich(x.html) + "</p>"; }
  h += '<section class="block" id="' + c + '-live" aria-labelledby="' + c + '-live-h">' + secHead("07", c + "-live", T.live) + '<div class="card"><span class="kind fact">' + esc(D.copy.live_kind) + "</span>" + B.map(pp).join("");
  h += '<form class="live-form" id="' + c + '-liveForm" autocomplete="off"><div><label for="' + c + '-fredKey">FRED API key</label><input id="' + c + '-fredKey" name="fredKey" type="password" spellcheck="false" placeholder="32 letters and numbers"></div><button type="submit" id="' + c + '-liveBtn">Refresh</button><button type="button" class="ghost" id="' + c + '-liveClear">Forget key</button></form>';
  h += '<div id="' + c + '-liveMsg" class="live-msg" role="status" aria-live="polite"></div>' + A.map(pp).join("");
  h += '<div class="tscroll" id="' + c + '-liveWrap" hidden style="margin-top:14px"><table style="min-width:680px"><caption>' + esc(D.copy.live_caption) + '</caption><thead><tr><th scope="col">Indicator</th><th scope="col">FRED code</th><th scope="col">Latest</th><th scope="col">Date</th><th scope="col">Snapshot value</th></tr></thead><tbody id="' + c + '-liveBody"></tbody></table></div></div></section>';

  // 08 gaps
  h += '<section class="block" id="' + c + '-gaps" aria-labelledby="' + c + '-gaps-h">' + secHead("08", c + "-gaps", T.gaps) + '<div class="card"><p>' + rich(D.copy.gaps_intro) + '</p><ul class="clean gaps">' + N.gaps.map(function (x) { return "<li>" + rich(x) + "</li>"; }).join("") + "</ul>";
  var de = (D.qa && D.qa.data_errors) || [];
  if (de.length) h += '<p class="small"><strong>Technical note:</strong> ' + de.length + " data request(s) failed in the latest update; affected values keep their last collected value.</p>";
  h += "</div></section>";
  h += '<p class="updated-line">Numbers updated: ' + esc(when(D.data_updated_at) === "—" ? "hand-checked snapshot, " + D.asof_label : when(D.data_updated_at)) + " · Explanations updated: " + esc(when(D.narrative_updated_at) === "—" ? D.asof_label + " (hand-checked)" : when(D.narrative_updated_at)) + (D.narrative_model ? " · Text written by: " + esc(D.narrative_model) : "") + "</p>";
  return h;
}
function missBox(miss) { return miss.length ? '<div class="missing"><h4>Not yet filled in</h4><ul>' + miss.map(function (m) { return '<li><span class="tag t-nc">Not collected</span> ' + esc(m) + "</li>"; }).join("") + "</ul></div>" : ""; }
function indRow(name, value, period, released, previous, tag, source, url, tone, nowLabel, w, x) {
  var t = TAG[tag] || TAG.official;
  var h = '<article class="ind"><div class="ind-top"><div><div class="ind-name">' + esc(name) + '</div><div class="ind-val">' + esc(value) + '</div></div><div><span class="ind-now now-' + (TONE_OK[tone] ? tone : "info") + '">' + esc(nowLabel || "") + "</span></div></div>";
  h += '<div class="ind-facts"><div><span>Period</span><b>' + esc(period) + "</b></div><div><span>Released</span><b>" + esc(released) + "</b></div><div><span>Previous</span><b>" + esc(previous) + '</b></div><div><span>Status · Source</span><b><span class="tag ' + t[1] + '">' + t[0] + "</span> " + link(source, url) + "</b></div></div>";
  if (x && x.manual) h += '<p class="small">Hand-checked snapshot. This number is not refreshed automatically yet.</p>';
  if (x && x.note) h += '<p class="small">' + esc(x.note) + "</p>";
  return h + '<div class="ind-why"><h5>What it is and why it matters</h5>' + (w || []).map(function (p) { return "<p>" + para(p) + "</p>"; }).join("") + "</div></article>";
}

/* ---------- optional live check against FRED (reader's own key, stored only in this browser) ---------- */
var KEY_NAME = "qf_fred_key";
function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function fmt(mode, obs) {
  var v = obs.filter(function (o) { return o.value !== "." && o.value !== ""; });
  if (!v.length) return null;
  var a = parseFloat(v[0].value), d = v[0].date;
  if (mode === "yoy") { var t = new Date(d + "T00:00:00Z"); t.setUTCFullYear(t.getUTCFullYear() - 1); var target = t.toISOString().slice(0, 10), prev = v.filter(function (o) { return o.date === target; })[0]; if (!prev) return { v: "n/a (need a year of data)", d: d }; var p = (a / parseFloat(prev.value) - 1) * 100; return { v: (p >= 0 ? "+" : "") + p.toFixed(1) + "%", d: d }; }
  if (mode === "chg") { if (v.length < 2) return { v: "n/a", d: d }; var c = Math.round((a - parseFloat(v[1].value)) * 1000); return { v: (c >= 0 ? "+" : "") + c.toLocaleString("en-US"), d: d }; }
  if (mode === "num") return { v: Math.abs(a) < 1000 ? a.toFixed(2) : Math.round(a).toLocaleString("en-US"), d: d };
  if (mode === "usd") return { v: "$" + a.toFixed(2), d: d };
  return { v: a.toFixed(2) + "%", d: d };
}
function getSeries(s, key) {
  var url = "https://api.stlouisfed.org/fred/series/observations?series_id=" + encodeURIComponent(s.id) + "&api_key=" + encodeURIComponent(key) + "&file_type=json&sort_order=desc&limit=" + (s.mode === "yoy" ? 14 : 12);
  var ctl = "AbortController" in window ? new AbortController() : null, timer = ctl ? setTimeout(function () { ctl.abort(); }, 15000) : null;
  return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) { if (timer) clearTimeout(timer); if (!r.ok) { var e = new Error("HTTP " + r.status); e.status = r.status; throw e; } return r.json(); }).then(function (j) { if (!j || !Array.isArray(j.observations)) throw new Error("bad"); return fmt(s.mode, j.observations); });
}
function wireLive(D) {
  var cc = D.code, SERIES = D.live_series || [];
  var input = document.getElementById(cc + "-fredKey"), msg = document.getElementById(cc + "-liveMsg"), btn = document.getElementById(cc + "-liveBtn"), body = document.getElementById(cc + "-liveBody"), wrap = document.getElementById(cc + "-liveWrap");
  if (!input) return;
  var saved = load(KEY_NAME); if (saved) input.value = saved;
  function say(k, t) { msg.className = "live-msg " + k; msg.textContent = t; }
  document.getElementById(cc + "-liveForm").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var key = input.value.trim();
    if (!/^[a-z0-9]{32}$/i.test(key)) { say("err", "That does not look like a FRED key. A key is 32 letters and numbers. Nothing on the page was changed."); return; }
    store(KEY_NAME, key); btn.disabled = true; say("info", "Asking FRED for the newest values…");
    getSeries(SERIES[0], key).then(function () { return Promise.all(SERIES.map(function (s) { return getSeries(s, key).then(function (r) { return { s: s, r: r }; }, function () { return { s: s, r: null }; }); })); })
      .then(function (res) {
        var h = "", ok = 0;
        res.forEach(function (x) { if (x.r) ok++; h += '<tr><th scope="row" style="font-weight:600">' + esc(x.s.label) + "</th><td>" + esc(x.s.id) + "</td><td><strong>" + (x.r ? esc(x.r.v) : '<span class="tag t-nc">Not loaded</span>') + "</strong></td><td>" + (x.r ? esc(x.r.d) : "—") + "</td><td>" + esc(x.s.snap) + "</td></tr>"; });
        body.innerHTML = h; wrap.hidden = false;
        say("ok", "Loaded " + ok + " of " + SERIES.length + " values from FRED at " + new Date().toLocaleString() + ". These are raw FRED numbers. The rest of the page is unchanged.");
      }).catch(function (e) {
        var t;
        if (e && (e.status === 400 || e.status === 401 || e.status === 403)) t = "FRED did not accept this key. It may be mistyped or not active yet. Please check it and try again.";
        else if (e && e.status === 429) t = "FRED says there have been too many requests. Please wait a minute and try again.";
        else if (e && e.name === "AbortError") t = "FRED took too long to answer. Please try again later.";
        else t = "Your browser blocked the request to FRED, or the internet connection failed. This is common, because FRED often does not allow web pages to request data directly. You can still check the numbers yourself at fred.stlouisfed.org.";
        say("err", t + " Nothing on this page has changed.");
      }).then(function () { btn.disabled = false; });
  });
  document.getElementById(cc + "-liveClear").addEventListener("click", function () { store(KEY_NAME, null); input.value = ""; say("info", "Your key has been removed from this browser."); });
}

/* ---------- loading ---------- */
var loaded = {};
function ensure(country) {
  if (loaded[country]) return loaded[country];
  var panel = document.getElementById("panel-" + country);
  loaded[country] = (country === "overview" ? getJson("overview.json").then(function (ov) { panel.innerHTML = renderOverview(ov); }) :
    getJson(country + ".json").then(function (D) { panel.innerHTML = renderCountry(D); wireLive(D); }))
    .catch(function () { loaded[country] = null; panel.innerHTML = '<p class="note" style="margin-top:30px">Sorry, the latest data could not be loaded. Please refresh the page in a minute.</p>'; });
  return loaded[country];
}

/* ---------- routing: overview + one country at a time ---------- */
var tabs = [].slice.call(document.querySelectorAll(".ctabs a"));
var tocRow = document.getElementById("tocRow");
var tocLinks = [].slice.call(tocRow.querySelectorAll("a"));
var current = null, io = null;
function show(country) {
  if (country === current) return false;
  current = country;
  document.getElementById("panel-overview").hidden = country !== "overview";
  CODES.forEach(function (c) { document.getElementById("panel-" + c).hidden = c !== country; });
  tabs.forEach(function (a) { a.setAttribute("aria-current", a.dataset.country === country ? "true" : "false"); });
  tocRow.hidden = country === "overview";
  tocLinks.forEach(function (a) { a.setAttribute("href", "#" + country + "-" + a.dataset.sec); a.classList.remove("active"); });
  ensure(country).then(function () {
    observe();
    var h = decodeURIComponent((location.hash || "").slice(1)), t = h && h !== country ? document.getElementById(h) : null;
    if (t) t.scrollIntoView();
  });
  return true;
}
function route(scroll) {
  var h = decodeURIComponent((location.hash || "").slice(1)) || "overview";
  var c = h.split("-")[0];
  if (CODES.indexOf(c) < 0) c = "overview";
  var changed = show(c);
  var target = h === c ? null : document.getElementById(h);
  if (target) target.scrollIntoView();
  else if (scroll !== false && changed) window.scrollTo(0, 0);
}
function go(h) {
  var c = h.split("-")[0];
  if (CODES.indexOf(c) < 0) c = "overview";
  var changed = show(c);
  var target = h === c || h === "overview" ? null : document.getElementById(h);
  if (target) window.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top + window.pageYOffset - 120), left: 0, behavior: "instant" });
  else if (changed || h === c) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  try { history.replaceState(null, "", "#" + h); } catch (e) {}
}
document.addEventListener("click", function (ev) {
  var a = ev.target.closest ? ev.target.closest("a") : null;
  if (!a) return;
  var href = a.getAttribute("href") || "";
  if (!href) return;
  if (href.charAt(0) === "#") {
    var h = decodeURIComponent(href.slice(1));
    if (!h) return;
    ev.preventDefault();
    go(h);
    return;
  }
  if (/^https?:\/\//i.test(href)) {
    if (a.getAttribute("target") !== "_blank") {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    }
  }
});
window.addEventListener("hashchange", function () { route(true); });
route(false);
// Tell a parent page (the homepage shows this monitor in a frame) that we are ready, and let it pick a country.
try { if (window.parent !== window) { window.parent.postMessage({ cbmReady: true }, "*"); window.addEventListener("message", function (e) { if (e.source === window.parent && e.data && e.data.cbmGo) go(e.data.cbmGo); }); } } catch (e) {}

/* highlight the current section in the sticky menu */
function observe() {
  if (!("IntersectionObserver" in window)) return;
  if (io) io.disconnect();
  if (current === "overview") return;
  io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { if (en.isIntersecting) tocLinks.forEach(function (a) { a.classList.toggle("active", a.getAttribute("href") === "#" + en.target.id); }); });
  }, { rootMargin: "-25% 0px -65% 0px" });
  document.querySelectorAll("#panel-" + current + " section[id], #panel-" + current + " .changed[id]").forEach(function (s) { io.observe(s); });
}

/* clocks */
var today = document.getElementById("today");
function tick() {
  var now = new Date();
  today.textContent = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  today.dateTime = now.toISOString().slice(0, 10);
  document.querySelectorAll(".clocks b[data-tz]").forEach(function (el) { try { el.textContent = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: el.dataset.tz }); } catch (e) {} });
}
tick(); setInterval(tick, 15000);
})();
