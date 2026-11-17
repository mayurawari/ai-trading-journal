import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { AI_FIELDS, type TradeRow, type FieldKey } from "@/core/fields";
import { DAILY_FIELDS, type DailyReflectionRow, normalizeDailyReflection, getNextEmptyDailyField } from "@/core/daily";
import { istDate } from "@/core/derive";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  assistantMessage: string;
  trades: TradeRow[];
  daily: DailyReflectionRow;
  suggestedReplies: string[];
  stage: "collecting_trades" | "daily_questions" | "ready_to_save";
}

export function deepMergeDaily(
  existing: DailyReflectionRow,
  incoming?: Record<string, unknown> | null,
): DailyReflectionRow {
  const merged: DailyReflectionRow = { ...existing };
  if (!incoming) return merged;

  const normalized = normalizeDailyReflection(incoming);
  for (const [key, val] of Object.entries(normalized)) {
    if (val !== null && val !== undefined && val !== "") {
      merged[key as keyof DailyReflectionRow] = val as any;
    }
  }
  return merged;
}

/**
 * Deduplicates trade rows within a session.
 * Multiple trades with the same asset, direction, entry price, or matching position parameters
 * are merged into a single position rather than duplicated.
 */
export function deduplicateTradeRows(trades: TradeRow[]): TradeRow[] {
  if (!Array.isArray(trades) || trades.length <= 1) return trades || [];

  const unique: TradeRow[] = [];

  for (const t of trades) {
    if (!t) continue;

    const tAsset = String(t.asset || t.symbol || "").toUpperCase().trim();
    const tDir = String(t.direction || "").toUpperCase().trim();
    const tEntry = t.entryPrice != null && t.entryPrice !== "" ? Number(t.entryPrice) : null;
    const tStop = t.stopLoss != null && t.stopLoss !== "" ? Number(t.stopLoss) : null;
    const tExit = t.exitPrice != null && t.exitPrice !== "" ? Number(t.exitPrice) : null;
    const tLot = t.lotSize != null && t.lotSize !== "" ? Number(t.lotSize) : null;

    // Check if this trade matches any trade already in unique
    const existingIndex = unique.findIndex((u) => {
      // If both have tradeIds, an exact ID match is the same trade
      if (t.tradeId && u.tradeId && t.tradeId === u.tradeId) {
        return true;
      }

      const uAsset = String(u.asset || u.symbol || "").toUpperCase().trim();
      const uDir = String(u.direction || "").toUpperCase().trim();
      const uEntry = u.entryPrice != null && u.entryPrice !== "" ? Number(u.entryPrice) : null;
      const uStop = u.stopLoss != null && u.stopLoss !== "" ? Number(u.stopLoss) : null;
      const uExit = u.exitPrice != null && u.exitPrice !== "" ? Number(u.exitPrice) : null;
      const uLot = u.lotSize != null && u.lotSize !== "" ? Number(u.lotSize) : null;

      // Rule 1: Same asset AND same direction AND same entry price -> 100% same trade!
      if (tAsset && uAsset && tAsset === uAsset && tDir && uDir && tDir === uDir && tEntry != null && uEntry != null && tEntry === uEntry) {
        return true;
      }

      // Rule 2: Same asset AND same entry price (if direction matches or omitted)
      if (tAsset && uAsset && tAsset === uAsset && tEntry != null && uEntry != null && tEntry === uEntry) {
        return true;
      }

      // Rule 3: Same asset AND same direction AND same stop/exit/lot ONLY if entry prices are not conflicting
      if (
        tAsset &&
        uAsset &&
        tAsset === uAsset &&
        tDir &&
        uDir &&
        tDir === uDir &&
        (tEntry == null || uEntry == null || tEntry === uEntry) &&
        ((tStop != null && uStop != null && tStop === uStop) ||
          (tExit != null && uExit != null && tExit === uExit) ||
          (tLot != null && uLot != null && tLot === uLot))
      ) {
        return true;
      }

      return false;
    });

    if (existingIndex >= 0) {
      // Merge all non-null fields from t into unique[existingIndex], updating existing values
      const existing = unique[existingIndex];
      for (const [k, v] of Object.entries(t)) {
        if (v !== null && v !== undefined && v !== "") {
          (existing as any)[k] = v;
        }
      }
    } else {
      unique.push({ ...t });
    }
  }

  return unique;
}

export function deepMergeTrades(existing: TradeRow[], incoming?: TradeRow[] | null): TradeRow[] {
  const safeExisting = Array.isArray(existing) ? existing : [];
  const safeIncoming = Array.isArray(incoming) ? incoming : [];

  if (safeIncoming.length === 0) return deduplicateTradeRows(safeExisting);
  if (safeExisting.length === 0) return deduplicateTradeRows(safeIncoming);

  // If existing and incoming have identical count, each incoming[i] is the updated state of existing[i]
  if (safeExisting.length === safeIncoming.length) {
    const merged: TradeRow[] = [];
    for (let i = 0; i < safeExisting.length; i++) {
      const base: TradeRow = { ...safeExisting[i] };
      for (const [k, v] of Object.entries(safeIncoming[i])) {
        if (v !== null && v !== undefined && v !== "") {
          base[k as FieldKey] = v as any;
        }
      }
      merged.push(base);
    }
    return deduplicateTradeRows(merged);
  }

  // If incoming has more trades than existing (trader added a new position)
  if (safeIncoming.length > safeExisting.length) {
    const merged: TradeRow[] = [];
    for (let i = 0; i < safeExisting.length; i++) {
      const base: TradeRow = { ...safeExisting[i] };
      for (const [k, v] of Object.entries(safeIncoming[i])) {
        if (v !== null && v !== undefined && v !== "") {
          base[k as FieldKey] = v as any;
        }
      }
      merged.push(base);
    }
    for (let i = safeExisting.length; i < safeIncoming.length; i++) {
      merged.push({ ...safeIncoming[i] });
    }
    return deduplicateTradeRows(merged);
  }

  // If incoming has fewer trades than existing, update matching trade without dropping others
  const updatedExisting = safeExisting.map((t) => ({ ...t }));
  for (const inc of safeIncoming) {
    const matchIdx = updatedExisting.findIndex((u) => {
      const uAsset = String(u.asset || u.symbol || "").toUpperCase().trim();
      const incAsset = String(inc.asset || inc.symbol || "").toUpperCase().trim();
      const uEntry = u.entryPrice != null && u.entryPrice !== "" ? Number(u.entryPrice) : null;
      const incEntry = inc.entryPrice != null && inc.entryPrice !== "" ? Number(inc.entryPrice) : null;
      return incAsset && uAsset && incAsset === uAsset && (incEntry == null || uEntry == null || incEntry === uEntry);
    });

    if (matchIdx >= 0) {
      for (const [k, v] of Object.entries(inc)) {
        if (v !== null && v !== undefined && v !== "") {
          updatedExisting[matchIdx][k as FieldKey] = v as any;
        }
      }
    }
  }

  return deduplicateTradeRows(updatedExisting);
}

/**
 * Validates that every mandatory field is present on a trade.
 * Mandatory fields: Asset, Direction (BUY/SELL), Entry Price, Stop Loss, Lot Size.
 */
export function validateTradeMandatoryFields(trade: TradeRow): {
  isComplete: boolean;
  missingFields: string[];
} {
  const missing: string[] = [];

  const hasAsset = Boolean(
    (trade.asset && String(trade.asset).trim()) || (trade.symbol && String(trade.symbol).trim()),
  );
  if (!hasAsset) missing.push("asset (e.g. Gold, Nifty, EURUSD)");

  const hasDir = Boolean(trade.direction && (trade.direction === "BUY" || trade.direction === "SELL"));
  if (!hasDir) missing.push("direction (BUY or SELL)");

  const hasEntry = trade.entryPrice != null && trade.entryPrice !== "" && Number.isFinite(Number(trade.entryPrice));
  if (!hasEntry) missing.push("entry price");

  const hasLot = trade.lotSize != null && trade.lotSize !== "" && Number.isFinite(Number(trade.lotSize));
  if (!hasLot) missing.push("lot size");

  const hasStop = trade.stopLoss != null && trade.stopLoss !== "" && Number.isFinite(Number(trade.stopLoss));
  if (!hasStop) missing.push("stop loss");

  return {
    isComplete: missing.length === 0,
    missingFields: missing,
  };
}

import { getNextMissingTradeField, type NextTradeQuestion } from "@/core/questionnaire";
export { getNextMissingTradeField, type NextTradeQuestion };

function tradeSchema(): Schema {
  const properties: Record<string, Schema> = {};

  for (const field of AI_FIELDS) {
    const base = { description: field.desc, nullable: true };

    if (field.key === "riskReward") {
      properties[field.key] = {
        ...base,
        type: Type.STRING,
        description: "Risk:Reward ratio if stated (e.g. '1:2', '1:2.5', '2R', '2') or decimal number.",
      };
    } else {
      properties[field.key] =
        field.type === "number"
          ? { ...base, type: Type.NUMBER }
          : field.type === "enum"
            ? { ...base, type: Type.STRING, enum: [...(field.values ?? [])] }
            : { ...base, type: Type.STRING };
    }
  }

  return {
    type: Type.OBJECT,
    properties,
    propertyOrdering: AI_FIELDS.map((f) => f.key),
  };
}

function dailySchema(): Schema {
  const properties: Record<string, Schema> = {};

  for (const field of DAILY_FIELDS) {
    if (field.type === "enum" && field.values) {
      properties[field.key] = {
        type: Type.STRING,
        enum: [...field.values],
        description: `${field.desc} (strictly one of: ${field.values.join(", ")})`,
        nullable: true,
      };
    } else {
      properties[field.key] = {
        type: Type.STRING,
        description: `${field.desc}. If numeric or balance, return as clean digits e.g. 50000 without symbols.`,
        nullable: true,
      };
    }
  }

  return {
    type: Type.OBJECT,
    properties,
  };
}

function chatResponseSchema(): Schema {
  return {
    type: Type.OBJECT,
    properties: {
      assistantMessage: {
        type: Type.STRING,
        description:
          "Conversational message to the user. Clear, helpful, concise, well-formatted with markdown. " +
          "Acknowledge what trades were detected, ask targeted follow-up questions for missing fields, " +
          "or ask daily reflection questions.",
      },
      trades: {
        type: Type.ARRAY,
        description: "List of all distinct trades identified so far, with their updated fields.",
        items: tradeSchema(),
      },
      daily: {
        ...dailySchema(),
        description: "The 10 daily reflection answers gathered so far.",
      },
      suggestedReplies: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description:
          "Clickable quick-reply option chips for the user if the assistant asked a question with discrete choices " +
          "(e.g. ['Very Confident', 'Confident', 'Less Confident'], ['London', 'New York', 'Asia'], ['Yes, 100%', 'Broke Rules']). " +
          "Leave empty if the question is purely free-form numerical/text.",
      },
      stage: {
        type: Type.STRING,
        enum: ["collecting_trades", "daily_questions", "ready_to_save"],
        description:
          "collecting_trades if trades still need required information. " +
          "daily_questions if trades are clear and we are doing daily check-in. " +
          "ready_to_save if all info is complete or user explicitly requested to save/finish.",
      },
    },
    required: ["assistantMessage", "trades", "stage"],
  };
}

function systemPrompt(): string {
  return [
    "You are Ledgerstone, an expert conversational trading journal companion. Motto: Every trade leaves a mark.",
    "Your goal: Eliminate manual journaling by chatting with the trader, capturing their trades accurately in natural language, asking questions for missing fields, conducting a daily psychological reflection, and saving the data to Google Sheets.",
    "",
    "CORE RULES:",
    "1. NEVER INVENT OR ESTIMATE NUMBERS. A blank field is fine. A fabricated price or lot size is unacceptable. Record strictly what the trader states.",
    "2. MULTI-TRADE AWARENESS & ZERO DUPLICATION:",
    "   - You can extract distinct multiple trades ONLY if the trader explicitly took multiple different positions (e.g. 'Longed Gold at 3385, then shorted Nifty at 24850').",
    "   - CRITICAL: ZERO DUPLICATE TRADES. If a trade is already in 'Existing trades tracked in session', ALWAYS update that trade in-place. NEVER append or create a duplicate entry for the same position! The trades array MUST contain strictly unique positions.",
    "   - MULTI-TRADE QUESTION SEQUENCING: When multiple trades are tracked, always ask ONE question for ONE trade at a time in sequence. Complete Trade 1 first, then Trade 2, etc. In every question, explicitly mention the trade number and asset (e.g. 'for Trade 1 (XAUUSD)', 'for Trade 2 (EURUSD)') so the trader knows exactly which position is being discussed. NEVER ask the same question twice.",
    "3. Understand trading terminology: 'longed', 'bought' -> BUY; 'shorted', 'sold' -> SELL; 'hit target' -> exit is target; 'stopped out' -> exit is stop loss.",
    "",
    "4. PER-TRADE FIELDS TO COLLECT (STRICT SEQUENCE):",
    "   For EVERY trade in 'trades', verify that the following core fields are populated:",
    "   - Asset / Symbol (e.g. Gold/XAUUSD, Nifty, BankNifty, BTCUSD, EURUSD) - MANDATORY.",
    "   - Direction (BUY or SELL) - MANDATORY.",
    "   - Entry Price - MANDATORY.",
    "   - Lot Size / Quantity - MANDATORY. Assign numeric lot/contract size to 'lotSize'.",
    "   - Stop Loss - MANDATORY. (If none, confirm 'No SL').",
    "   - Exit Price or Target - MANDATORY for closed trades.",
    "   - Session (ASIA, LONDON, NEW YORK, OVERLAP)",
    "   - Market Condition (e.g. Trending smoothly, Choppy / Ranging, High volatility / News, Key level reversal) - MANDATORY to ask if empty.",
    "   - Setup Name / Strategy - Entry trigger / pattern name.",
    "   - Reason for Entry - Trigger / confluence in trader's own words - MANDATORY to ask if empty.",
    "   - Reason for Exit - Why the trade was closed (hit TP, stopped out, trailing SL, manual close) - MANDATORY to ask if empty.",
    "   - Emotion Before Trade - Feelings before entering.",
    "   - Emotion During Trade - Dominant emotion while holding position - MANDATORY to ask if empty.",
    "   - Emotion After Trade - Feelings after closing - MANDATORY to ask if empty.",
    "   - Rule Adherence (FOLLOWED (100%), PARTIAL, BROKE RULES).",
    "   - Execution Mistakes (NONE, FOMO, REVENGE, EARLY ENTRY, CHASED PRICE, MOVED SL/TP, OVERTRADING, OTHER).",
    "   DECOMMISSIONED FIELDS: Do NOT ask for or record Position Size, Risk ($ / %), Confidence Rating, PnL %, Holding Time, TradingView Link, Screenshot Link, or Lessons Learned.",
    "",
    "5. STRICT ONE QUESTION AT A TIME RULE:",
    "   You MUST ask strictly ONE question per turn. NEVER ask two or three questions in the same message.",
    "   Whichever field is empty in the sequence, ask ONLY that question.",
    "   - For trades: Ask for the single next missing field on Trade 1, then Trade 2, etc.",
    "   - For daily reflection: Follow the exact column order from the sheet:",
    "     1. Sleep & Energy (Options: High Energy & Rested, Moderate, Low / Fatigued)",
    "     2. Dominant Emotion (Options: Calm & Focused, Confident, Anxious, Excited, Frustrated, Tired)",
    "     3. Starting Balance (Dynamic number - suggestedReplies MUST BE EMPTY)",
    "     4. Ending Balance (Dynamic number - suggestedReplies MUST BE EMPTY)",
    "     5. Limits Followed (Options: Yes, followed limits, No, exceeded limits)",
    "     6. Impulsive / Revenge (Options: None (Disciplined), Impulsive Trade, Revenge Traded, Boredom Trade)",
    "     7. Valid Setups Skipped (Options: None skipped, Hesitated on trigger, Missed session open)",
    "     8. Biggest Mistake (Options: None / Followed plan, Early exit, Chased price, Moved SL)",
    "     9. Best Decision (Options: Followed trading plan, Patient entry, Cut loss quickly, Respected stop loss)",
    "     10. Market Conditions (Options: Trending smoothly, Choppy / Ranging, High volatility / News, Normal conditions)",
    "     11. One Thing to Improve (Options: Better patience, Strict stop loss discipline, Wait for candle close, Manage risk size)",
    "",
    "   CRITICAL CHIP RULES:",
    "   - When asking an option-based question, suggestedReplies MUST contain ONLY that single question's choices.",
    "   - When asking a dynamic number question (like Starting Balance or Ending Balance), suggestedReplies MUST BE EMPTY ([]). NEVER show option chips from another question!",
    "",
    "7. STAGE TRANSITION RULES:",
    "   - 'collecting_trades': If any trade is missing asset, direction, entry price, stop loss, or lot size.",
    "   - 'daily_questions': When trades are verified and we are asking the single next empty daily reflection field.",
    "   - 'ready_to_save': ONLY when both trades AND all 11 daily reflection questions are answered, OR when the user explicitly commands 'save now', 'save trades', 'skip daily questions', 'done', or 'finish'.",
    "",
    "8. STRICT FORMATTING RULE: NEVER use emojis, icons, or italic formatting (*text* or _text_) anywhere in your responses. Always use clean plain text, with bold (**text**) only for key field names.",
    "",
    `Current date in IST: ${istDate()}. Use this for 'today' or to resolve relative days.`,
  ].join("\n");
}

async function generateWithRetry(
  ai: GoogleGenAI,
  contents: { text: string }[],
  config: Record<string, unknown>,
) {
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const callPromise = ai.models.generateContent({
        model,
        contents,
        config: config as any,
      });

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Gemini request timed out after 12s")), 12000),
      );

      return await Promise.race([callPromise, timeoutPromise]);
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        msg.includes("503") ||
        msg.includes("UNAVAILABLE") ||
        msg.includes("high demand") ||
        msg.includes("timed out") ||
        msg.includes("429") ||
        msg.includes("RESOURCE_EXHAUSTED");

      if (isTransient && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

function getGroqApiKey(): string | null {
  const key = process.env.GROQ_API_KEY || process.env.GROK_API_KEY;
  return key?.trim() || null;
}

function getGeminiApiKeys(): string[] {
  const raw = process.env.GEMINI_API_KEY || "";
  return raw
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

/**
 * High-speed inference using Groq (14,400 free requests/day with Llama 3 / GPT-OSS).
 */
async function callGroq(
  apiKey: string,
  messages: ChatMessage[],
  currentTrades: TradeRow[],
  dailyAnswers: DailyReflectionRow,
): Promise<ChatResponse> {
  const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

  const contextPrompt = [
    "CURRENT CONVERSATION CONTEXT:",
    `Existing trades tracked in session: ${JSON.stringify(currentTrades, null, 2)}`,
    `Existing daily reflection answers: ${JSON.stringify(dailyAnswers, null, 2)}`,
    "",
    "Analyze the conversation history and user's latest input.",
    "Update the trades array with any new or modified trades.",
    "Update daily reflection fields (sleepEnergy, dominantEmotion, startingBalance, endingBalance, limitsFollowed, impulsiveTrades, skippedSetups, biggestMistake, bestDecision, marketConditions, improvementGoal).",
    "Return clickable quick-reply option chips in suggestedReplies when asking questions with standard choices.",
    "Set stage to 'collecting_trades' if trade details are missing, 'daily_questions' if trades are complete and daily check-in is ongoing, or 'ready_to_save' if finished or user wants to save.",
    "",
    "CRITICAL: Always output valid JSON strictly matching this structure:",
    JSON.stringify({
      assistantMessage: "Helpful conversational message in Markdown",
      trades: currentTrades,
      daily: dailyAnswers,
      suggestedReplies: ["Option 1", "Option 2"],
      stage: "collecting_trades",
    }),
  ].join("\n");

  const groqMessages = [
    { role: "system", content: `${systemPrompt()}\n\n${contextPrompt}` },
    ...messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: groqMessages,
      response_format: { type: "json_object" },
      temperature: 0.2,
    }),
    signal: controller.signal,
  });

  clearTimeout(timeout);

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Groq API returned ${res.status}: ${errorBody}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Groq returned empty content.");

  const parsed = JSON.parse(text) as ChatResponse;

  return {
    assistantMessage: parsed.assistantMessage || "I've logged your input.",
    trades: deepMergeTrades(currentTrades, Array.isArray(parsed.trades) ? parsed.trades : []),
    daily: deepMergeDaily(dailyAnswers, parsed.daily),
    suggestedReplies: Array.isArray(parsed.suggestedReplies) ? parsed.suggestedReplies : [],
    stage: parsed.stage || "collecting_trades",
  };
}

/**
 * Fallback to Google Gemini with automatic multi-key rotation on 429, 503, or timeout.
 */
async function callGemini(
  messages: ChatMessage[],
  currentTrades: TradeRow[],
  dailyAnswers: DailyReflectionRow,
): Promise<ChatResponse> {
  const keys = getGeminiApiKeys();
  if (keys.length === 0) {
    throw new Error("Missing GEMINI_API_KEY in .env");
  }

  let lastError: unknown;

  for (let keyIdx = 0; keyIdx < keys.length; keyIdx++) {
    const apiKey = keys[keyIdx];
    try {
      const ai = new GoogleGenAI({ apiKey });

      const contextPrompt = [
        "CURRENT CONVERSATION CONTEXT:",
        `Existing trades tracked in session: ${JSON.stringify(currentTrades, null, 2)}`,
        `Existing daily reflection answers: ${JSON.stringify(dailyAnswers, null, 2)}`,
        "",
        "Analyze the conversation history, user's latest input, update the trades array and daily reflection, determine missing fields, provide natural assistant response and suggestedReplies chips.",
      ].join("\n");

      const contents = [
        { text: contextPrompt },
        ...messages.map((m) => ({
          text: `${m.role === "user" ? "Trader" : "Assistant"}: ${m.content}`,
        })),
      ];

      const response = await generateWithRetry(ai, contents, {
        systemInstruction: systemPrompt(),
        responseMimeType: "application/json",
        responseSchema: chatResponseSchema(),
        temperature: 0.2,
        thinkingConfig: { thinkingBudget: 0 },
      });

      const text = response.text?.trim();
      if (!text) {
        throw new Error("Gemini returned an empty response.");
      }

      const parsed = JSON.parse(text) as ChatResponse;

      return {
        assistantMessage: parsed.assistantMessage || "I've logged your input.",
        trades: deepMergeTrades(currentTrades, Array.isArray(parsed.trades) ? parsed.trades : []),
        daily: deepMergeDaily(dailyAnswers, parsed.daily),
        suggestedReplies: Array.isArray(parsed.suggestedReplies) ? parsed.suggestedReplies : [],
        stage: parsed.stage || "collecting_trades",
      };
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);

      // Rotate to next Gemini key on ANY error, timeout, or quota exhaustion
      if (keyIdx < keys.length - 1) {
        console.warn(`[ai] Gemini Key ${keyIdx + 1} failed (${msg}), auto-switching to Key ${keyIdx + 2}...`);
        continue;
      }
      break;
    }
  }

  throw lastError;
}

/**
 * Tier 3 Deterministic Rule-Based Fallback:
 * If both Groq and all Gemini keys fail, rate-limit, or time out,
 * this engine evaluates the conversation state with pure TypeScript
 * to smoothly ask the single next missing question with zero latency.
 */
export function deterministicFallback(
  messages: ChatMessage[],
  currentTrades: TradeRow[],
  dailyAnswers: DailyReflectionRow,
): ChatResponse {
  const nextMissingTrade = getNextMissingTradeField(currentTrades);
  if (nextMissingTrade) {
    return {
      assistantMessage: nextMissingTrade.question,
      trades: currentTrades,
      daily: dailyAnswers,
      suggestedReplies: nextMissingTrade.options,
      stage: "collecting_trades",
    };
  }

  const nextDaily = getNextEmptyDailyField(dailyAnswers);
  if (nextDaily) {
    return {
      assistantMessage: `**Daily Reflection (${nextDaily.stepNumber}/${nextDaily.totalSteps}): ${nextDaily.header}**\n\n${nextDaily.question}`,
      trades: currentTrades,
      daily: dailyAnswers,
      suggestedReplies: nextDaily.options,
      stage: "daily_questions",
    };
  }

  return {
    assistantMessage:
      "All trade and daily reflection details are verified and complete.\n\n" +
      "Tap **Save trades now** below to record your journal directly to Google Sheets.",
    trades: currentTrades,
    daily: dailyAnswers,
    suggestedReplies: ["Save trades now", "Open Sheet"],
    stage: "ready_to_save",
  };
}

export async function processChatTurn(
  messages: ChatMessage[],
  currentTrades: TradeRow[] = [],
  dailyAnswers: DailyReflectionRow = {},
): Promise<ChatResponse> {
  const groqKey = getGroqApiKey();

  // Tier 1: Try Groq first for ultra-fast response with high quota (14,400 free requests/day)
  if (groqKey) {
    try {
      return await callGroq(groqKey, messages, currentTrades, dailyAnswers);
    } catch (groqErr) {
      console.warn("[ai] Tier 1 (Groq) failed or timed out, falling back to Gemini:", groqErr instanceof Error ? groqErr.message : groqErr);
    }
  }

  // Tier 2: Fallback to Google Gemini (with automatic multi-key rotation across all configured keys)
  try {
    return await callGemini(messages, currentTrades, dailyAnswers);
  } catch (geminiErr) {
    console.warn("[ai] Tier 2 (Gemini) failed across all keys, engaging Tier 3 Deterministic Fallback:", geminiErr instanceof Error ? geminiErr.message : geminiErr);
  }

  // Tier 3: Deterministic Rule-Based Fallback (Zero network dependency, 100% uptime)
  return deterministicFallback(messages, currentTrades, dailyAnswers);
}
