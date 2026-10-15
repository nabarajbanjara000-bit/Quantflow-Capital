# Country data connections

One file per country: `scripts/countries/<code>.mjs`, `export default { ... }`. Codes: us, japan, germany, canada, newzealand, australia, switzerland, uk.
The page text and the hand-checked snapshot (Oct 14, 2026) live in `public/monitor/data/<code>.json`; the list of indicator ids is in `scripts/seed/<code>.indicators.json`.

```js
export default {
  code: "uk",
  // The next 3-4 policy meetings, from the central bank's OWN published calendar (cite the URL in a comment).
  // `label` / `decision_label` are the exact sentences the page prints (copy the style of the snapshot: public/monitor/data/<code>.json -> meeting).
  meetings: [{ start: "2026-11-04", end: "2026-11-05", label: "...", decision_label: "Thursday, Nov 5, 12:00 p.m. GMT" }, ...],
  calendar_url: "https://...", calendar_label: "Official ... announcement dates",
  // Official statements / minutes / speeches (RSS or Atom). Test each URL.
  feeds: [{ id: "decisions", url: "https://..." }],
  // Links the AI may write (official domains only: central bank, statistics office, treasury, ...)
  allowed_domains: ["bankofengland.co.uk", "ons.gov.uk", ...],
  // ONLY the indicators you can refresh automatically. `id` must match scripts/seed/<code>.indicators.json.
  // Indicators you leave out stay as the hand-checked snapshot ("Not refreshed automatically").
  indicators: [
    { id: "consumer_price_index_cpi_all_items", kind: "pct", freq: "m", decimals: 1,
      // optional: tag: "secondary" if the feed is not official, note: "...",
      get: async ({ getText, getJson, csvObjects, parseCsv, isoDate, fred, today }) => [ { date: "2026-08-01", value: 3.1, released: "2026-09-16" /* optional */ }, ...newest first ] },
  ],
  kpis: [{ id: "bank_rate", label: "Bank of England rate", note: "optional extra text" }],   // exactly 4 tiles, same order as the snapshot's kpis_seed
  overview: { rate: { id }, prices: { id, label: "CPI" }, jobless: { id, label: "..." }, tenyr: { id, label: "..." } },   // cards + compare table on the overview page
  // Upcoming reports (next ~90 days) from OFFICIAL release calendars. Reuse the snapshot's release ids where it is the same report.
  releases: [{ id, name, publisher, date: "2026-10-21", date_label: "Wed Oct 21", time: "7:00 a.m.", url, what: "plain-words description", weekly: false }],
};
```

Observation format returned by `get()`: array, NEWEST FIRST, `{ date: "YYYY-MM-DD", value: number, released?: "YYYY-MM-DD" }`.
`kind` decides the display (see `scripts/lib/indicators.mjs`): `pct`, `level` (prefix/suffix/decimals), `yoy_mom` / `mom_yoy` / `mom` (give index LEVELS, need 14+ months), `num`, `chg_k`, `mil_k`, `usd`.
Use `kind: "pct"` when the source already publishes a percent (e.g. "CPI annual rate"), `yoy_mom` when it publishes an index.

Test with:  `node scripts/tools/check-country.mjs <code>`  (live network, no keys; FRED needs FRED_API_KEY, which may not be available, so prefer official feeds).
Rules: official sources first; a secondary source must say `tag: "secondary"`; never invent a number, date or URL; if no reliable feed exists, leave the indicator out.
