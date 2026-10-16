# Quant Flow Capital — Operational Rules & Standards

## 1. Daily Update Schedule
- **Time:** Exactly at **12:00 AM (midnight) Nepal Time (NPT = UTC+5:45)** every day.
- **Automated Workflow:** Defined in `.github/workflows/update-monitor.yml` (`cron: "15 18 * * *"` which triggers at 18:15 UTC = 00:00 NPT).
- **Execution Script:** `node scripts/update.mjs`.

## 2. Authentic Primary Data Sources Only
When collecting, updating, or summarizing macroeconomic and central bank data:
- **Strictly use authentic official sources:**
  - **Federal Reserve** (Board of Governors, FOMC statements, minutes, FRED data series).
  - **U.S. Government Agencies:** Bureau of Labor Statistics (BLS), Bureau of Economic Analysis (BEA), U.S. Treasury, Census Bureau.
  - **Major Central Banks:** European Central Bank (ECB), Bank of Japan (BoJ), Bank of England (BoE), Bank of Canada (BoC), Reserve Bank of Australia (RBA), Reserve Bank of New Zealand (RBNZ), Swiss National Bank (SNB).
  - **Official Statistics Agencies:** Eurostat, Statistics Bureau of Japan, Office for National Statistics (ONS), Statistics Canada, Australian Bureau of Statistics (ABS), Stats NZ, Swiss FSO / SECO.
- **Rule on Numbers & Links:**
  - Never invent, estimate, or hallucinate figures or dates.
  - Links must only point to verified official government/central bank domains.

## 3. Senior Economist & Leadership Analysis
- When summarizing daily market and central bank data, actively observe and integrate remarks, forward guidance, and analysis from senior-level economists and central bank leadership:
  - **Federal Reserve Chairman** (Jerome Powell) and Federal Reserve Governors/regional bank presidents.
  - **ECB President** (Christine Lagarde) and Executive Board members.
  - **Bank of Japan Governor** (Kazuo Ueda) and Policy Board members.
  - **Bank of England Governor** (Andrew Bailey) and MPC members.
  - Prominent senior institutional economists and chief macro strategists.
- Exact quotes must only be used if they appear verbatim in official transcripts, speeches, or press conference recordings. Otherwise, synthesize and paraphrase their stances accurately.
