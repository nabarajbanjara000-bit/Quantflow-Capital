// The AI step: asks Google Gemini (or Anthropic Claude as an optional alternative) for JSON text.
// The browser never sees any key; this only runs inside the daily GitHub job.
import { sleep } from "./http.mjs";

export const MOCK = process.env.MOCK === "1";
export const MOCK_AI = MOCK && process.env.MOCK_AI !== "0"; // MOCK_AI=0: fake data but a real (or local test) AI call
const GEMINI_BASE = process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com";
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || "";
export const PROVIDER = (process.env.AI_PROVIDER || (GEMINI_KEY ? "gemini" : ANTHROPIC_KEY ? "anthropic" : "")).toLowerCase();
export const AI_KEY = PROVIDER === "gemini" ? GEMINI_KEY : PROVIDER === "anthropic" ? ANTHROPIC_KEY : "";
// gemini-2.5-* is closed to new API users; 3.8 Flash is Google's recommended model for new projects.
export const MODEL = PROVIDER === "gemini" ? (process.env.GEMINI_MODEL || "gemini-3.8-flash") : (process.env.CLAUDE_MODEL || "claude-sonnet-5-5");
export const MODEL_LABEL = `${PROVIDER === "gemini" ? "Google Gemini" : "Anthropic Claude"} (${MODEL})`;
let busyStreak = 0;
export const aiUnavailable = () => busyStreak >= 2; // two countries in a row failed: stop asking for the rest of this run
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.5-flash-lite").split(",").filter(Boolean);
const warn = (...a) => console.warn("[monitor] WARNING:", ...a);

export async function callAI(system, user) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 9 * 60 * 1000);
  try {
    if (PROVIDER === "gemini") {
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.3, maxOutputTokens: 32768 }
      });
      // Busy (429 / 5xx) or network errors are usually short-lived: try each model twice, then the fallback model.
      // If everything is busy, throw quickly (err.busy) so the job moves on instead of waiting for minutes per country.
      let r, j, last = "";
      for (const model of [MODEL, ...FALLBACK_MODELS.filter(m => m !== MODEL)]) {
        const url = `${GEMINI_BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
        for (let i = 0; i < 2; i++) {
          if (i) await sleep(20000);
          try {
            r = await fetch(url, { method: "POST", signal: ctl.signal, headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_KEY }, body });
            j = await r.json().catch(() => ({}));
          } catch (e) { r = null; last = `${model}: network error (${e.cause && e.cause.code || e.message})`; warn(last); continue; }
          if (r.status === 429 || r.status >= 500) { last = `${model}: HTTP ${r.status}`; warn(`Gemini busy (${last})`); continue; }
          break;
        }
        if (r && r.status !== 429 && r.status < 500) break;
      }
      if (!r || r.status === 429 || r.status >= 500) { busyStreak++; throw Object.assign(new Error(`Gemini unavailable (${last})`), { busy: true }); }
      busyStreak = 0;
      if (!r.ok) throw new Error(`Gemini API ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
      const cand = (j.candidates || [])[0];
      if (!cand || !cand.content) throw new Error(`Gemini returned no text (finishReason: ${cand && cand.finishReason}, block: ${j.promptFeedback && j.promptFeedback.blockReason})`);
      // Thinking tokens count toward maxOutputTokens; a cut-off answer is not valid JSON, so say why.
      if (cand.finishReason === "MAX_TOKENS") throw new Error("Gemini answer was cut off (MAX_TOKENS)");
      return (cand.content.parts || []).filter(p => !p.thought).map(p => p.text || "").join("");
    }
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctl.signal,
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 32000, system, messages: [{ role: "user", content: user }], stream: false })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`Claude API ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
    return (j.content || []).filter(c => c.type === "text").map(c => c.text).join("");
  } finally { clearTimeout(t); }
}

export function extractJson(txt) {
  const a = txt.indexOf("{"), b = txt.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("no JSON object in reply");
  return JSON.parse(txt.slice(a, b + 1));
}
