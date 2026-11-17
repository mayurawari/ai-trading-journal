import { AI_FIELDS, type FieldKey, type TradeRow } from "./fields";

/**
 * Derived fields — calculated, never asked for, never AI-guessed.
 * Pure functions only (ARCHITECTURE.md §4): no I/O, so these are trivially testable.
 */

const TZ = "Asia/Kolkata"; // IST — locked in ARCHITECTURE.md §10

/** "YYYY-MM-DD" in IST. en-CA formats as ISO date. */
export function istDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** "HH:mm" in IST, 24-hour. */
export function istTime(at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
}

/** "YYYY-MM-DD HH:mm:ss" in IST — what goes in Created Timestamp. */
export function istTimestamp(at: Date = new Date()): string {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(at);
  return `${istDate(at)} ${time}`;
}

/** ISO-8601 week number. Handles year boundaries correctly. */
export function isoWeek(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00Z`);
  // Shift to the Thursday of this week; the ISO week is that Thursday's week.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function monthName(dateStr: string): string {
  return new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" })
    .format(new Date(`${dateStr}T00:00:00Z`));
}

export function yearOf(dateStr: string): number {
  return Number(dateStr.slice(0, 4));
}

/** Sortable, collision-resistant id: T-20260729-143022-4f2a */
export function makeTradeId(at: Date = new Date()): string {
  const stamp = istTimestamp(at).replace(/[-: ]/g, "");
  return `T-${stamp.slice(0, 8)}-${stamp.slice(8)}-${Math.random().toString(16).slice(2, 6)}`;
}

export function getAssetMultiplier(assetStr?: string | null): number {
  if (!assetStr) return 1;
  const clean = assetStr.toUpperCase().replace(/[^A-Z0-9]/g, "");

  if (clean.includes("XAU") || clean.includes("GOLD")) {
    return 100; // 100 oz per standard lot
  }
  if (clean.includes("XAG") || clean.includes("SILVER")) {
    return 5000; // 5000 oz per standard lot
  }
  if (clean.includes("OIL") || clean.includes("CL") || clean.includes("WTI")) {
    return 1000; // 1000 barrels per contract
  }
  const fxCurrencies = ["EUR", "GBP", "USD", "JPY", "AUD", "CAD", "CHF", "NZD"];
  const isForex = fxCurrencies.some((c) => clean.startsWith(c)) && clean.length === 6;
  if (isForex) {
    return 100000; // 100,000 units per standard FX lot
  }

  return 1;
}

/** Computes gross PnL deterministically if not explicitly provided by the user. */
export function calculatePnL(trade: TradeRow): number | null {
  if (trade.pnl != null && trade.pnl !== "" && Number.isFinite(Number(trade.pnl))) {
    return Number(trade.pnl);
  }

  const entry = Number(trade.entryPrice);
  const exit = Number(trade.exitPrice);
  const dir = String(trade.direction || "").toUpperCase();
  const lot = Number(trade.lotSize ?? (trade as any).positionSize ?? 0);

  if (!Number.isFinite(entry) || !Number.isFinite(exit) || !dir || !Number.isFinite(lot) || lot <= 0) {
    return null;
  }

  const multiplier = getAssetMultiplier(String(trade.asset || trade.symbol || ""));
  const directionMultiplier = dir === "BUY" ? 1 : -1;
  const rawPnL = (exit - entry) * directionMultiplier * multiplier * lot;

  return Number(rawPnL.toFixed(2));
}

/** Robust extraction of numeric values from natural language user input. */
export function extractNumber(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;

  const str = String(raw).trim();
  if (!str) return null;

  // Handle shorthand 'k' e.g. "50k", "50.5k"
  const kMatch = str.match(/(\d+(?:\.\d+)?)\s*k\b/i);
  if (kMatch) {
    const val = Number(kMatch[1]) * 1000;
    if (Number.isFinite(val)) return val;
  }

  // Remove commas (thousands separators), currency symbols, units
  const cleaned = str
    .replace(/,/g, "")
    .replace(/[$₹€£]/g, " ")
    .replace(/\b(?:lots?|contracts?|units?|pts?|pips?)\b/gi, " ");

  const numMatch = cleaned.match(/([+-]?\d+(?:\.\d+)?)/);
  if (numMatch) {
    const val = Number(numMatch[1]);
    if (Number.isFinite(val)) return val;
  }

  return null;
}

/** Parses stated Risk:Reward strings like "1:2", "1:2.5", "2R", "1 to 2", "rr 2", "2:1" into a decimal number. */
export function parseRiskReward(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;

  const str = String(raw).trim();
  if (!str) return null;

  // Pattern: "1:2.5" or "1:2" or "1/2" or "1 to 2" or "1:2 rr"
  const ratioMatch = str.match(/(?:1\s*[:/]\s*|1\s+to\s+)(\d+(?:\.\d+)?)/i);
  if (ratioMatch) {
    const val = Number(ratioMatch[1]);
    if (Number.isFinite(val) && val > 0) return val;
  }

  // Pattern: "2:1" or "2.5:1" or "3/1"
  const invRatioMatch = str.match(/(\d+(?:\.\d+)?)\s*[:/]\s*1\b/i);
  if (invRatioMatch) {
    const val = Number(invRatioMatch[1]);
    if (Number.isFinite(val) && val > 0) return val;
  }

  // Pattern: "2R" or "2.5R" or "+2R"
  const rMatch = str.match(/([+-]?\d+(?:\.\d+)?)\s*r\b/i);
  if (rMatch) {
    const val = Number(rMatch[1]);
    if (Number.isFinite(val) && val > 0) return val;
  }

  // Pattern: "RR 2" or "RR of 2" or "R:R 2.5" or "risk reward 2" or "rr: 2"
  const rrMatch = str.match(/(?:r(?::?r)?|risk\s*reward)\s*(?:is|=|of|was|:)?\s*(\d+(?:\.\d+)?)/i);
  if (rrMatch) {
    const val = Number(rrMatch[1]);
    if (Number.isFinite(val) && val > 0) return val;
  }

  // Pattern: purely a standalone single number e.g. "2" or "2.5" or "3"
  const standaloneMatch = str.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
  if (standaloneMatch) {
    const val = Number(standaloneMatch[1]);
    if (Number.isFinite(val) && val > 0 && val <= 100) return val;
  }

  return null;
}

/** Planned or realized reward ÷ planned risk. Evaluates planned target first, then realized exit. */
export function riskReward(
  entry?: number | null,
  stop?: number | null,
  target?: number | null,
  exit?: number | null,
): number | null {
  if (entry == null || stop == null) return null;
  const risk = Math.abs(entry - stop);
  if (risk === 0) return null;

  if (target != null && target !== 0 && Number.isFinite(Number(target))) {
    return Number((Math.abs(Number(target) - entry) / risk).toFixed(2));
  }

  if (exit != null && exit !== 0 && Number.isFinite(Number(exit))) {
    return Number((Math.abs(Number(exit) - entry) / risk).toFixed(2));
  }

  return null;
}

/** WIN / LOSS / BE. Prefers stated PnL; falls back to entry vs exit. */
export function result(trade: TradeRow): "WIN" | "LOSS" | "BE" | null {
  const pnl = trade.pnl as number | null | undefined;
  if (pnl != null) return pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : "BE";

  const entry = trade.entryPrice as number | null | undefined;
  const exit = trade.exitPrice as number | null | undefined;
  const dir = trade.direction as string | null | undefined;
  if (entry == null || exit == null || !dir) return null;

  const move = dir === "BUY" ? exit - entry : entry - exit;
  return move > 0 ? "WIN" : move < 0 ? "LOSS" : "BE";
}

/**
 * Sanitizes and normalizes raw trade data.
 * Guarantees that numeric fields receive strictly valid numbers (never strings or sentences)
 * and enums/shorthand are properly transformed.
 */
export function cleanTrade(raw: Record<string, unknown>): TradeRow {
  const trade: TradeRow = {};

  for (const field of AI_FIELDS) {
    const value = raw[field.key];
    if (value === null || value === undefined || value === "") continue;

    if (field.type === "number") {
      if (field.key === "riskReward") {
        const rr = parseRiskReward(value);
        if (rr != null) trade.riskReward = rr;
      } else {
        const n = extractNumber(value);
        if (n != null) trade[field.key as FieldKey] = n;
      }
    } else if (field.type === "enum" && field.values) {
      const strVal = String(value).trim().toUpperCase();
      const matched = field.values.find(
        (v) => v.toUpperCase() === strVal || strVal.includes(v.toUpperCase()),
      );
      if (matched) {
        trade[field.key as FieldKey] = matched;
      } else {
        trade[field.key as FieldKey] = String(value).trim();
      }
    } else {
      trade[field.key as FieldKey] = String(value).trim();
    }
  }

  // Auto-harmonize lotSize if positionSize was passed in raw input
  const rawPos = (raw as Record<string, unknown>).positionSize;
  if ((trade.lotSize == null || trade.lotSize === "") && rawPos != null && rawPos !== "") {
    const pos = Number(rawPos);
    if (Number.isFinite(pos) && pos <= 500) {
      trade.lotSize = pos;
    }
  }

  return trade;
}

/** Fill every derived field. Values already present are respected, not overwritten. */
export function deriveAll(trade: TradeRow, at: Date = new Date()): TradeRow {
  const date = (trade.date as string) || istDate(at);
  const derivedPnL = calculatePnL(trade);
  const explicitRR = parseRiskReward(trade.riskReward);

  // If target wasn't set, but entry, stop, direction, and RR are known, compute planned target
  let target = trade.target != null && trade.target !== "" ? Number(trade.target) : null;
  if (!target && explicitRR && trade.entryPrice && trade.stopLoss && trade.direction) {
    const entry = Number(trade.entryPrice);
    const stop = Number(trade.stopLoss);
    const risk = Math.abs(entry - stop);
    if (risk > 0) {
      target =
        trade.direction === "BUY"
          ? Number((entry + risk * explicitRR).toFixed(2))
          : Number((entry - risk * explicitRR).toFixed(2));
    }
  }

  return {
    ...trade,
    tradeId: trade.tradeId ?? makeTradeId(at),
    date,
    time: trade.time ?? istTime(at),
    timezone: "IST",
    weekNumber: isoWeek(date),
    month: monthName(date),
    year: yearOf(date),
    symbol: trade.symbol ?? trade.asset ?? null,
    target: target ?? trade.target ?? null,
    pnl: trade.pnl ?? derivedPnL,
    riskReward:
      explicitRR ??
      riskReward(
        trade.entryPrice as number | null,
        trade.stopLoss as number | null,
        target as number | null,
        trade.exitPrice as number | null,
      ),
    result: trade.result ?? result({ ...trade, pnl: trade.pnl ?? derivedPnL }),
    createdAt: istTimestamp(at),
  };
}
