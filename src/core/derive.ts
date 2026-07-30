import type { TradeRow } from "./fields";

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

/** Planned reward ÷ planned risk. Null unless entry, stop and target are all known. */
export function riskReward(
  entry?: number | null,
  stop?: number | null,
  target?: number | null,
): number | null {
  if (entry == null || stop == null || target == null) return null;
  const risk = Math.abs(entry - stop);
  if (risk === 0) return null;
  return Number((Math.abs(target - entry) / risk).toFixed(2));
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

/** Fill every derived field. Values already present are respected, not overwritten. */
export function deriveAll(trade: TradeRow, at: Date = new Date()): TradeRow {
  const date = (trade.date as string) || istDate(at);

  return {
    ...trade,
    tradeId: trade.tradeId ?? makeTradeId(at),
    date,
    timezone: "IST",
    weekNumber: isoWeek(date),
    month: monthName(date),
    year: yearOf(date),
    riskReward:
      trade.riskReward ??
      riskReward(
        trade.entryPrice as number | null,
        trade.stopLoss as number | null,
        trade.target as number | null,
      ),
    result: trade.result ?? result(trade),
    createdAt: istTimestamp(at),
  };
}
