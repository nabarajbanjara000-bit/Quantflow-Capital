# Quant Flow Capital website

Static site (plain HTML/CSS/JS, no build step). Netlify publishes only `public/`.

| Path | What it is |
|---|---|
| `public/index.html` | Homepage (research library + central-bank cards) |
| `public/monitor/` | Global Central Bank Monitor (8 countries). `monitor.js` draws the page from `data/*.json` |
| `public/monitor/data/<code>.json` | One country's numbers and text. **Rewritten daily by the update job.** |
| `public/monitor/data/overview.json` | Overview page and homepage cards (built from the 8 files) |
| `scripts/update.mjs` | The daily updater |
| `scripts/countries/<code>.mjs` | Each country's data connections, meeting dates, news feeds, report calendar |
| `scripts/prompt.md` | The AI's writing rules (edit to change tone or rules) |
| `scripts/lib/` | Shared code: number formatting, AI call, safety checks |
| `scripts/tools/` | One-time converters and `check-country.mjs` (live test of one country) |
| `.github/workflows/update-monitor.yml` | The schedule |

## How a daily update works
1. For each country, collect numbers from official sources (`scripts/countries/*.mjs`). Every number on the page comes from code, never from the AI.
2. Read new official statements, minutes and speeches (RSS/Atom).
3. If something changed, or the text is 7+ days old, the AI (Google Gemini) rewrites the plain-language text. Checks reject the rewrite if a quote is not word-for-word in an official text, chances do not add to 100, an option gets 95%+, banned words appear, or a link is not official. One retry; then the previous text is kept and the numbers still update.
4. If most numbers for a country fail to download, that country is left unchanged.
5. The workflow commits `public/monitor/data`; Netlify redeploys.

Indicators a country module does not automate stay as the hand-checked snapshot of Oct 14, 2026 and are labelled so on the page.

## Secrets (GitHub → Settings → Secrets and variables → Actions)
`GEMINI_API_KEY` (required), `FRED_API_KEY` (required for the US), optional variable `GEMINI_MODEL` (default `gemini-3.8-flash`).

## Commands
```
npm test                       # offline mock run, writes to mock-output/ only
npm run update                 # real run (needs keys in the environment)
npm run check -- uk            # live test of one country's connections
COUNTRIES=us,uk FORCE_AI=1 npm run update
```

## Upkeep
- **Meeting calendars** (`meetings` in each country file): refresh when a bank publishes next year's dates. The page warns when a calendar has run out.
- **Report calendars** (`releases`): static lists from official calendars; refresh every few months (the US reads FRED live).
- If a source changes its format, `qa.data_errors` in the country's JSON says which indicator failed; the page keeps its last value.
