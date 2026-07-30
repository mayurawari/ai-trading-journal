import { GoogleGenAI } from "@google/genai";
import { buildResponseSchema } from "./schema";
import { AI_FIELDS, type FieldKey, type TradeRow } from "@/core/fields";
import { istDate } from "@/core/derive";

/**
 * The instruction that decides whether this app is trustworthy.
 *
 * The single most important line is the one about null. A blank cell is a small
 * annoyance; an invented entry price silently corrupts the journal and every
 * number ever calculated from it.
 */
function systemPrompt(): string {
  return [
    "You read a trader's plain-English description of trades they have already taken,",
    "and pull out structured fields from it.",
    "",
    "Rules, in order of importance:",
    "",
    "1. Record ONLY what the trader actually said. If a field is not stated, return null.",
    "2. NEVER invent, estimate or infer a number. A blank field is fine. A wrong price is not.",
    "3. Do NOT calculate anything. Risk-reward, week number and win/loss are computed",
    "   elsewhere by the app — leave them alone.",
    "4. Understand casual trading language: 'longed', 'went long', 'bought' → BUY;",
    "   'shorted', 'sold', 'bearish entry' → SELL. Expand tickers and slang where obvious.",
    "5. If they say price hit target, the exit price is the target. If they say they were",
    "   stopped out, the exit price is the stop loss.",
    "6. Free-text fields keep the trader's own voice, condensed to a line. Never add advice,",
    "   judgement, encouragement or anything they did not say.",
    "",
    "SPLITTING INTO SEPARATE TRADES",
    "",
    "One message may describe several trades. Return one entry per distinct trade,",
    "in the order they were taken.",
    "",
    "Two trades when: different instruments; or the same instrument entered and exited,",
    "then entered again; or they clearly say it was a second/another trade.",
    "",
    "ONE trade when: they describe a single position across many sentences; or they add",
    "reflection, emotion or lessons afterwards; or they scaled into or out of one position;",
    "or they moved the stop on one position.",
    "",
    "When genuinely unsure, prefer ONE trade — merging is easier to spot and fix than a",
    "phantom trade the reader has to notice and delete.",
    "",
    "Details stated once but applying to all of them — the date, the session, the mood that",
    "day — belong on every trade they apply to.",
    "",
    `Today's date is ${istDate()} (IST). Use it for "today", and to work out "yesterday",`,
    '"last Friday" and similar.',
  ].join("\n");
}

/** Gemini can return "3385.2" as a string; the sheet wants a real number. */
function coerce(raw: Record<string, unknown>): TradeRow {
  const trade: TradeRow = {};

  for (const field of AI_FIELDS) {
    const value = raw[field.key];

    if (value === null || value === undefined || value === "") continue;

    if (field.type === "number") {
      const n = typeof value === "number" ? value : Number(String(value).replace(/[, ]/g, ""));
      if (Number.isFinite(n)) trade[field.key as FieldKey] = n;
      continue;
    }

    const text = String(value).trim();
    if (text) trade[field.key as FieldKey] = text;
  }

  return trade;
}

/**
 * Send the trader's text to Gemini and get structured fields back.
 * Always returns a list — one entry per trade described.
 */
export async function extractTrades(text: string): Promise<TradeRow[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY in .env — get a free key at aistudio.google.com/apikey");
  }

  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
    contents: text,
    config: {
      systemInstruction: systemPrompt(),
      responseMimeType: "application/json",
      responseSchema: buildResponseSchema(),
      temperature: 0, // extraction is mechanical — same input should give the same fields
      // Extraction needs no deliberation, and thinking would add seconds per turn.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const body = response.text?.trim();
  if (!body) throw new Error("Gemini returned an empty response.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("Gemini did not return valid JSON. Try rewording your description.");
  }

  const list = (parsed as { trades?: unknown })?.trades;
  if (!Array.isArray(list)) throw new Error("Gemini returned an unexpected shape.");

  const trades = list
    .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
    .map(coerce)
    .filter((t) => Object.keys(t).length > 0); // drop anything that came back entirely blank

  if (trades.length === 0) {
    throw new Error("No trade details found in that text. Try adding the instrument and prices.");
  }

  return trades;
}
