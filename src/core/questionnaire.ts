import { type FieldKey, type TradeRow } from "./fields";
import { extractNumber, parseRiskReward } from "./derive";
import {
  type DailyFieldKey,
  type DailyReflectionRow,
  getNextEmptyDailyField,
  normalizeDailyReflection,
  type NextDailyQuestion,
} from "./daily";

export interface NextTradeQuestion {
  tradeIndex: number;
  field: string;
  question: string;
  options: string[];
}

/**
 * Returns the single next missing field on trades in strict priority order.
 * Follows the "ONE QUESTION AT A TIME" rule.
 */
export function getNextMissingTradeField(trades: TradeRow[]): NextTradeQuestion | null {
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    const tradeLabel = trades.length > 1 ? ` for Trade ${i + 1} (${t.asset || t.symbol || "Position"})` : "";

    // 1. Asset / Symbol
    const hasAsset = Boolean((t.asset && String(t.asset).trim()) || (t.symbol && String(t.symbol).trim()));
    if (!hasAsset) {
      return {
        tradeIndex: i,
        field: "asset",
        question: `Which **asset or instrument** did you trade${tradeLabel} (e.g. Gold, Nifty, BTC, EURUSD)?`,
        options: ["Gold (XAUUSD)", "Nifty 50", "BankNifty", "BTCUSD", "EURUSD"],
      };
    }

    // 2. Direction
    const hasDir = Boolean(t.direction && (t.direction === "BUY" || t.direction === "SELL"));
    if (!hasDir) {
      return {
        tradeIndex: i,
        field: "direction",
        question: `Was your ${t.asset || t.symbol} position a **BUY (Long)** or **SELL (Short)**${tradeLabel}?`,
        options: ["BUY (Long)", "SELL (Short)"],
      };
    }

    // 3. Entry Price
    const hasEntry = t.entryPrice != null && t.entryPrice !== "" && Number.isFinite(Number(t.entryPrice));
    if (!hasEntry) {
      return {
        tradeIndex: i,
        field: "entryPrice",
        question: `What was your **entry price** for ${t.direction || ""} ${t.asset || t.symbol}${tradeLabel}?`,
        options: [],
      };
    }

    // 4. Lot Size / Quantity
    const hasLot = t.lotSize != null && t.lotSize !== "" && Number.isFinite(Number(t.lotSize));
    if (!hasLot) {
      return {
        tradeIndex: i,
        field: "lotSize",
        question: `What was your **lot size or contract quantity** for this ${t.asset || t.symbol} trade${tradeLabel}?`,
        options: ["1 lot", "0.5 lots", "0.1 lots", "0.05 lots", "0.03 lots"],
      };
    }

    // 5. Stop Loss
    const hasStop = t.stopLoss != null && t.stopLoss !== "" && Number.isFinite(Number(t.stopLoss));
    if (!hasStop) {
      return {
        tradeIndex: i,
        field: "stopLoss",
        question: `What was your **stop loss** price for this ${t.asset || t.symbol} trade${tradeLabel}?`,
        options: ["No Stop Loss", "SL at Breakeven"],
      };
    }

    // 6. Exit Price or Target
    const hasExit = (t.exitPrice != null && t.exitPrice !== "") || (t.target != null && t.target !== "");
    if (!hasExit) {
      return {
        tradeIndex: i,
        field: "exitPrice",
        question: `What was your **exit price or target outcome** for this ${t.asset || t.symbol} trade${tradeLabel}?`,
        options: ["Hit Target", "Hit Stop Loss", "Manual Close at BE"],
      };
    }

    // 7. Trading Session
    const hasSession = Boolean(t.session && String(t.session).trim());
    if (!hasSession) {
      return {
        tradeIndex: i,
        field: "session",
        question: `Which **trading session** did you take this ${t.asset || t.symbol} trade in${tradeLabel}?`,
        options: ["London Session", "New York Session", "Asian Session", "Overlap"],
      };
    }

    // 8. Market Condition (Trending, Choppy, News, Reversal)
    const hasMarketCondition = Boolean(t.marketCondition && String(t.marketCondition).trim());
    if (!hasMarketCondition) {
      return {
        tradeIndex: i,
        field: "marketCondition",
        question: `What were the **market conditions** during this ${t.asset || t.symbol} trade${tradeLabel} (e.g. trending, choppy, news volatility)?`,
        options: ["Trending Smoothly", "Choppy / Ranging", "High Volatility / News", "Key Level Reversal"],
      };
    }

    // 9. Setup / Strategy
    const hasSetup = Boolean((t.setupName && String(t.setupName).trim()) || (t.strategy && String(t.strategy).trim()));
    if (!hasSetup) {
      return {
        tradeIndex: i,
        field: "setupName",
        question: `What was your **setup or entry trigger** for this ${t.asset || t.symbol} trade${tradeLabel}?`,
        options: ["Breakout / Retest", "Order Block / FVG", "Liquidity Sweep", "Trend Following", "Support / Resistance"],
      };
    }

    // 10. Reason for Entry
    const hasReasonForEntry = Boolean(t.reasonForEntry && String(t.reasonForEntry).trim());
    if (!hasReasonForEntry) {
      return {
        tradeIndex: i,
        field: "reasonForEntry",
        question: `What was your **reason for entry** (trigger / confluence) for this ${t.asset || t.symbol} trade${tradeLabel}?`,
        options: ["Breakout + Retest", "Liquidity Grab / Sweep", "Order Block / FVG", "Trendline Bounce", "Support / Resistance Rejection"],
      };
    }

    // 11. Reason for Exit
    const hasReasonForExit = Boolean(t.reasonForExit && String(t.reasonForExit).trim());
    if (!hasReasonForExit) {
      return {
        tradeIndex: i,
        field: "reasonForExit",
        question: `What was your **reason for exit** for this ${t.asset || t.symbol} trade${tradeLabel}?`,
        options: ["Hit Take Profit Target", "Hit Stop Loss", "Trailing Stop Triggered", "Manual Close at Resistance", "Closed at Breakeven"],
      };
    }

    // 12. Emotion Before Trade
    const hasEmotionBefore = Boolean(t.emotionBefore && String(t.emotionBefore).trim());
    if (!hasEmotionBefore) {
      return {
        tradeIndex: i,
        field: "emotionBefore",
        question: `What was your **dominant emotion before entering** this ${t.asset || t.symbol} trade${tradeLabel}?`,
        options: ["Calm & Patient", "Confident", "Anxious / Hesitant", "FOMO / Rushed"],
      };
    }

    // 13. Emotion During Trade
    const hasEmotionDuring = Boolean(t.emotionDuring && String(t.emotionDuring).trim());
    if (!hasEmotionDuring) {
      return {
        tradeIndex: i,
        field: "emotionDuring",
        question: `What was your **dominant emotion while holding** this ${t.asset || t.symbol} trade${tradeLabel}?`,
        options: ["Calm & Detached", "Anxious / Watching PnL", "Confident & Patient", "Impulsive / Tempted to exit early"],
      };
    }

    // 14. Emotion After Trade
    const hasEmotionAfter = Boolean(t.emotionAfter && String(t.emotionAfter).trim());
    if (!hasEmotionAfter) {
      return {
        tradeIndex: i,
        field: "emotionAfter",
        question: `How did you feel **after closing** this ${t.asset || t.symbol} trade${tradeLabel}?`,
        options: ["Satisfied (Followed Plan)", "Relieved", "Frustrated / Regretful", "Neutral & Ready for next"],
      };
    }

    // 15. Rule Adherence
    const hasRuleAdherence = Boolean(t.ruleAdherence && String(t.ruleAdherence).trim());
    if (!hasRuleAdherence) {
      return {
        tradeIndex: i,
        field: "ruleAdherence",
        question: `Did you follow your **trading plan rules** on this ${t.asset || t.symbol} trade${tradeLabel}?`,
        options: ["FOLLOWED (100%)", "PARTIAL", "BROKE RULES"],
      };
    }

    // 16. Execution Mistakes
    const hasMistake = Boolean(t.executionMistakes && String(t.executionMistakes).trim());
    if (!hasMistake) {
      return {
        tradeIndex: i,
        field: "executionMistakes",
        question: `Were there any **execution mistakes** on this ${t.asset || t.symbol} trade${tradeLabel}?`,
        options: ["NONE (Clean Trade)", "FOMO Entry", "Moved Stop Loss", "Early Exit", "Chased Price", "Overtrading"],
      };
    }
  }

  return null;
}

/**
 * Deterministically applies an answer to a trade's field.
 */
export function applyTradeAnswer(trade: TradeRow, field: string, answer: string): TradeRow {
  const updated: TradeRow = { ...trade };
  const trimmed = answer.trim();
  const lower = trimmed.toLowerCase();

  switch (field) {
    case "asset": {
      const cleanAsset = trimmed.replace(/^(?:i\s+traded|traded|it\s+was|symbol\s+is|asset\s+is)\s+/i, "").trim();
      updated.asset = cleanAsset || trimmed;
      if (!updated.symbol) updated.symbol = updated.asset;
      break;
    }
    case "direction": {
      updated.direction = lower.includes("buy") || lower.includes("long") || lower.includes("bull") ? "BUY" : "SELL";
      break;
    }
    case "entryPrice": {
      const n = extractNumber(trimmed);
      if (n != null && n > 0) updated.entryPrice = n;
      break;
    }
    case "lotSize": {
      const n = extractNumber(trimmed);
      if (n != null && n > 0) updated.lotSize = n;
      break;
    }
    case "stopLoss": {
      if (lower.includes("no sl") || lower.includes("none") || lower.includes("without sl") || lower.includes("no stop")) {
        updated.stopLoss = 0;
      } else {
        const n = extractNumber(trimmed);
        if (n != null) updated.stopLoss = n;
      }
      break;
    }
    case "exitPrice": {
      if (lower.includes("hit target") || lower.includes("target hit") || lower.includes("tp hit")) {
        if (updated.target != null) {
          updated.exitPrice = Number(updated.target);
        } else if (updated.entryPrice != null && updated.stopLoss != null) {
          const rr = parseRiskReward(updated.riskReward) || 2;
          const risk = Math.abs(Number(updated.entryPrice) - Number(updated.stopLoss));
          updated.exitPrice =
            updated.direction === "SELL"
              ? Number(updated.entryPrice) - risk * rr
              : Number(updated.entryPrice) + risk * rr;
        }
      } else if (lower.includes("hit stop loss") || lower.includes("stopped out") || lower.includes("sl hit")) {
        if (updated.stopLoss != null) updated.exitPrice = Number(updated.stopLoss);
      } else if (lower.includes("breakeven") || lower.includes("be")) {
        if (updated.entryPrice != null) updated.exitPrice = Number(updated.entryPrice);
      } else {
        const n = extractNumber(trimmed);
        if (n != null && n > 0) updated.exitPrice = n;
      }
      const statedRR = parseRiskReward(trimmed);
      if (statedRR != null) updated.riskReward = statedRR;
      break;
    }
    case "session": {
      const upper = trimmed.toUpperCase();
      if (upper.includes("LONDON")) updated.session = "LONDON";
      else if (upper.includes("NEW YORK") || upper.includes("NY")) updated.session = "NEW YORK";
      else if (upper.includes("ASIA") || upper.includes("TOKYO")) updated.session = "ASIA";
      else if (upper.includes("OVERLAP")) updated.session = "OVERLAP";
      else updated.session = trimmed;
      break;
    }
    case "marketCondition": {
      updated.marketCondition = trimmed;
      break;
    }
    case "setupName":
    case "strategy": {
      updated.setupName = trimmed;
      updated.strategy = trimmed;
      break;
    }
    case "reasonForEntry": {
      updated.reasonForEntry = trimmed;
      break;
    }
    case "reasonForExit": {
      updated.reasonForExit = trimmed;
      break;
    }
    case "emotionBefore": {
      updated.emotionBefore = trimmed;
      break;
    }
    case "emotionDuring": {
      updated.emotionDuring = trimmed;
      break;
    }
    case "emotionAfter": {
      updated.emotionAfter = trimmed;
      break;
    }
    case "ruleAdherence": {
      const upper = trimmed.toUpperCase();
      if (upper.includes("100") || upper.includes("FOLLOWED") || upper.includes("YES") || upper.includes("DISCIPLIN")) {
        updated.ruleAdherence = "FOLLOWED (100%)";
      } else if (upper.includes("PARTIAL") || upper.includes("SOME")) {
        updated.ruleAdherence = "PARTIAL";
      } else if (upper.includes("BROKE") || upper.includes("NO") || upper.includes("FAILED")) {
        updated.ruleAdherence = "BROKE RULES";
      } else {
        updated.ruleAdherence = trimmed;
      }
      break;
    }
    case "executionMistakes": {
      const upper = trimmed.toUpperCase();
      if (upper.includes("NONE") || upper.includes("CLEAN") || upper.includes("DISCIPLIN") || upper.includes("NO") || upper.includes("ZERO")) {
        updated.executionMistakes = "NONE";
      } else if (upper.includes("FOMO")) updated.executionMistakes = "FOMO";
      else if (upper.includes("REVENGE")) updated.executionMistakes = "REVENGE";
      else if (upper.includes("MOVED SL") || upper.includes("STOP")) updated.executionMistakes = "MOVED SL/TP";
      else if (upper.includes("EARLY")) updated.executionMistakes = "EARLY ENTRY";
      else if (upper.includes("CHASED")) updated.executionMistakes = "CHASED PRICE";
      else if (upper.includes("OVERTRAD")) updated.executionMistakes = "OVERTRADING";
      else updated.executionMistakes = trimmed;
      break;
    }
    default: {
      (updated as Record<string, unknown>)[field] = trimmed;
      break;
    }
  }

  return updated;
}

/**
 * Deterministically applies an answer to daily reflection.
 */
export function applyDailyAnswer(
  daily: DailyReflectionRow,
  key: DailyFieldKey,
  answer: string,
): DailyReflectionRow {
  const normalized = normalizeDailyReflection({ [key]: answer });
  return {
    ...daily,
    ...normalized,
  };
}
