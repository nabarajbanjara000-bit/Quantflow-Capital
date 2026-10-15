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
const warn = (...a) => console.warn("[monitor] WARNING:", ...a);

export async function callAI(system, user) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 9 * 60 * 1000);
  try {
    if (PROVIDER === "gemini") {
      const url = `${GEMINI_BASE}/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`;
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.3, maxOutputTokens: 32768 }
      });
      let r, j;
      // "Busy" answers (429 / 5xx, e.g. "model is experiencing high demand") are usually short-lived: wait and try again.
      for (let i = 0; i < 4; i++) {
        if (i) { warn(`Gemini busy (HTTP ${r.status}); waiting ${30 * i}s before trying again`); await sleep(30000 * i); }
        r = await fetch(url, { method: "POST", signal: ctl.signal, headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_KEY }, body });
        j = await r.json().catch(() => ({}));
        if (r.status !== 429 && r.status < 500) break;
      }
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
