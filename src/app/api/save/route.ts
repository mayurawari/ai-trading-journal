import { NextResponse, type NextRequest } from "next/server";
import { appendTrades, appendDailyReflection, getActiveEnvironment, type JournalEnvironment } from "@/services/google/sheets";
import { cleanTrade, deriveAll, istDate, istTimestamp } from "@/core/derive";
import { deduplicateTradeRows } from "@/services/gemini/chat";
import { type TradeRow } from "@/core/fields";
import { normalizeDailyReflection, type DailyReflectionRow } from "@/core/daily";
import { SESSION_COOKIE, getSessionEmail } from "@/lib/session";
import { acquireDistributedLock, releaseDistributedLock } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Takes the trades as CONFIRMED in the review panel — not the raw AI output — then
 * recomputes the derived columns and appends one row per trade. Also records daily reflection if provided.
 */
export async function POST(request: NextRequest) {
  try {
    const cookie = request.cookies.get(SESSION_COOKIE)?.value;
    const userEmail = (await getSessionEmail(cookie)) || undefined;

    const { trades, daily, mode } = (await request.json()) as {
      trades?: Record<string, unknown>[];
      daily?: Record<string, unknown>;
      mode?: JournalEnvironment;
    };

    if (!Array.isArray(trades) || trades.length === 0) {
      return NextResponse.json({ ok: false, error: "No trades to save." }, { status: 400 });
    }

    const complete = deduplicateTradeRows(trades.map(cleanTrade))
      .filter((t) => Object.keys(t).length > 0)
      // Derived per trade, so each row gets its own id, week number and risk/reward.
      .map((t) => deriveAll(t));

    if (complete.length === 0) {
      return NextResponse.json({ ok: false, error: "Every field is empty." }, { status: 400 });
    }

    const targetEnv: JournalEnvironment = userEmail ? (mode || (await getActiveEnvironment(userEmail))) : "test";

    // Local Demo Sandbox bypass: no Google account required
    if (!userEmail && targetEnv === "test") {
      let dailySaved = false;
      let fullDaily: DailyReflectionRow | undefined;
      if (daily && Object.keys(daily).length > 0) {
        fullDaily = {
          ...normalizeDailyReflection(daily),
          date: String(daily.date || istDate()),
          createdAt: istTimestamp(),
        };
        dailySaved = true;
      }

      return NextResponse.json({
        ok: true,
        isDemo: true,
        demoLocal: true,
        url: "#demo-sheet",
        updatedRange: `Trades!A2:AF${complete.length + 1}`,
        rows: complete.length,
        dailySaved,
        daily: fullDaily,
        alreadySaved: false,
        skippedDuplicates: 0,
        trades: complete,
        tradeIds: complete.map((t) => t.tradeId),
        message: "Successfully saved to Local Demo Sandbox.",
      });
    }

    const lockKey = `lock:save:${userEmail || "anonymous"}`;
    const lockAcquired = await acquireDistributedLock(lockKey, 15);
    if (!lockAcquired) {
      return NextResponse.json(
        { ok: false, error: "A save operation is currently in progress. Please wait a moment." },
        { status: 429 },
      );
    }

    try {
      let saveResult;
      try {
        saveResult = await appendTrades(complete, userEmail, targetEnv);
      } catch (appendErr) {
        console.error("[save] Failed appendTrades in targetEnv:", targetEnv, appendErr);
        if (targetEnv === "test") {
          return NextResponse.json({
            ok: true,
            isDemo: true,
            demoLocal: true,
            url: "#demo-sheet",
            updatedRange: `Trades!A2:AF${complete.length + 1}`,
            rows: complete.length,
            dailySaved: Boolean(daily && Object.keys(daily).length > 0),
            alreadySaved: false,
            skippedDuplicates: 0,
            trades: complete,
            tradeIds: complete.map((t) => t.tradeId),
            message: "Successfully recorded in Local Demo Sandbox.",
          });
        }
        throw appendErr;
      }
      const { url, updatedRange, rows, alreadySaved, skippedDuplicates } = saveResult;

      let dailySaved = false;
      if (daily && Object.keys(daily).length > 0) {
        try {
          const fullDaily: DailyReflectionRow = {
            ...normalizeDailyReflection(daily),
            date: String(daily.date || istDate()),
            createdAt: istTimestamp(),
          };
          await appendDailyReflection(fullDaily, userEmail, targetEnv);
          dailySaved = true;
        } catch (dailyErr) {
          console.error("Failed to append daily reflection in /api/save:", dailyErr);
        }
      }

      return NextResponse.json({
        ok: true,
        url,
        updatedRange,
        rows,
        dailySaved,
        alreadySaved,
        skippedDuplicates,
        tradeIds: complete.map((t) => t.tradeId),
      });
    } finally {
      await releaseDistributedLock(lockKey);
    }
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
