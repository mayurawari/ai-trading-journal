import { NextResponse, type NextRequest } from "next/server";
import { appendTrades } from "@/services/google/sheets";
import { deriveAll } from "@/core/derive";
import { AI_FIELDS, type FieldKey, type TradeRow } from "@/core/fields";

export const dynamic = "force-dynamic";

/**
 * Only accept known AI fields from the browser. Derived columns are the app's job,
 * so nothing the page sends can overwrite a calculated value.
 */
function clean(raw: Record<string, unknown>): TradeRow {
  const trade: TradeRow = {};

  for (const field of AI_FIELDS) {
    const value = raw[field.key];
    if (value === null || value === undefined || value === "") continue;

    if (field.type === "number") {
      const n = Number(String(value).replace(/[, ]/g, ""));
      if (Number.isFinite(n)) trade[field.key as FieldKey] = n;
    } else {
      trade[field.key as FieldKey] = String(value).trim();
    }
  }

  return trade;
}

/**
 * Takes the trades as CONFIRMED in the review panel — not the raw AI output — then
 * recomputes the derived columns and appends one row per trade.
 */
export async function POST(request: NextRequest) {
  try {
    const { trades } = (await request.json()) as { trades?: Record<string, unknown>[] };

    if (!Array.isArray(trades) || trades.length === 0) {
      return NextResponse.json({ ok: false, error: "No trades to save." }, { status: 400 });
    }

    const complete = trades
      .map(clean)
      .filter((t) => Object.keys(t).length > 0)
      // Derived per trade, so each row gets its own id, week number and risk/reward.
      .map((t) => deriveAll(t));

    if (complete.length === 0) {
      return NextResponse.json({ ok: false, error: "Every field is empty." }, { status: 400 });
    }

    const { url, updatedRange, rows } = await appendTrades(complete);

    return NextResponse.json({
      ok: true,
      url,
      updatedRange,
      rows,
      tradeIds: complete.map((t) => t.tradeId),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Save failed";
    return NextResponse.json(
      {
        ok: false,
        error:
          message === "NOT_CONNECTED"
            ? "Not connected to Google — reconnect and try again."
            : message,
      },
      { status: message === "NOT_CONNECTED" ? 401 : 500 },
    );
  }
}
