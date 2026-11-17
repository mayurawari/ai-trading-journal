import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import {
  countTrades,
  getOrCreateSpreadsheet,
  getSavedSpreadsheetId,
  getActiveEnvironment,
  setActiveEnvironment,
  getSheetConfig,
  saveSheetConfig,
  sheetUrl,
  type JournalEnvironment,
} from "@/services/google/sheets";
import {
  SESSION_COOKIE,
  USER_COOKIE,
  USER_COOKIE_OPTIONS,
  getSessionEmail,
} from "@/lib/session";

export const dynamic = "force-dynamic";

/** Reports authentication and Google Sheet status scoped to the current user and environment. */
export async function GET(request: NextRequest) {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const email = await getSessionEmail(session);

  if (!email) {
    const response = NextResponse.json({
      connected: false,
      environment: "test",
      demoAvailable: true,
      sheet: {
        url: "#demo-sheet",
        trades: 0,
        environment: "test",
      },
    });
    response.cookies.set(USER_COOKIE, "", {
      ...USER_COOKIE_OPTIONS,
      maxAge: 0,
    });
    return response;
  }

  const activeEnv = await getActiveEnvironment(email);
  const realId = await getSavedSpreadsheetId(email, "real");
  const testId = await getSavedSpreadsheetId(email, "test");
  const userConfig = await getSheetConfig(email);

  let activeSpreadsheetId = activeEnv === "test" ? testId : realId;
  let activeTradesCount: number | null =
    activeEnv === "test" ? (userConfig.testTradesCount ?? null) : (userConfig.realTradesCount ?? null);

  const shouldFetchCount =
    request.nextUrl.searchParams.get("count") === "1" || activeTradesCount === null;

  try {
    if (!activeSpreadsheetId) {
      const sheet = await getOrCreateSpreadsheet(email, activeEnv);
      activeSpreadsheetId = sheet.spreadsheetId;
      activeTradesCount = 0;
    } else if (shouldFetchCount) {
      try {
        // Fast race: max 700ms so network calls to Google Sheets don't stall the UI
        activeTradesCount = await Promise.race([
          countTrades(activeSpreadsheetId, email),
          new Promise<number>((_, reject) =>
            setTimeout(() => reject(new Error("Sheet count timed out")), 700),
          ),
        ]);
      } catch {
        // Fall back gracefully to existing cached count or 0 without failing status
        activeTradesCount = activeTradesCount ?? 0;
      }
    }

    // Refresh IDs in case creation occurred
    const refreshedRealId = await getSavedSpreadsheetId(email, "real");
    const refreshedTestId = await getSavedSpreadsheetId(email, "test");

    const response = NextResponse.json({
      connected: true,
      email,
      environment: activeEnv,
      sheet: {
        url: sheetUrl(activeSpreadsheetId),
        trades: activeTradesCount,
        environment: activeEnv,
      },
      realSheet: {
        id: refreshedRealId,
        url: refreshedRealId ? sheetUrl(refreshedRealId) : null,
      },
      testSheet: {
        id: refreshedTestId,
        url: refreshedTestId ? sheetUrl(refreshedTestId) : null,
      },
    });
    response.cookies.set(USER_COOKIE, email, USER_COOKIE_OPTIONS);
    return response;
  } catch (error) {
    const response = NextResponse.json({
      connected: true,
      email,
      environment: activeEnv,
      sheet: activeSpreadsheetId
        ? { url: sheetUrl(activeSpreadsheetId), trades: activeTradesCount, environment: activeEnv }
        : null,
      realSheet: { id: realId, url: realId ? sheetUrl(realId) : null },
      testSheet: { id: testId, url: testId ? sheetUrl(testId) : null },
      warning: error instanceof Error ? error.message : "Could not initialize sheet",
    });
    response.cookies.set(USER_COOKIE, email, USER_COOKIE_OPTIONS);
    return response;
  }
}

/** Switches the active journal environment (real vs test) and ensures the sheet exists in Drive. */
export async function POST(request: NextRequest) {
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  const email = await getSessionEmail(session);

  const body = (await request.json().catch(() => ({}))) as { mode?: JournalEnvironment };
  const targetMode: JournalEnvironment = body.mode === "test" ? "test" : "real";

  if (!email) {
    if (targetMode === "test") {
      return NextResponse.json({
        ok: true,
        connected: false,
        environment: "test",
        demoAvailable: true,
        sheet: {
          url: "#demo-sheet",
          trades: 0,
          environment: "test",
        },
      });
    }
    return NextResponse.json(
      { ok: false, connected: false, error: "Connecting with Google is required to switch to Live Journal." },
      { status: 401 }
    );
  }

  try {

    await setActiveEnvironment(targetMode, email);

    // Ensure the spreadsheet for this environment exists and is initialized
    const sheet = await getOrCreateSpreadsheet(email, targetMode);
    const tradesCount = await countTrades(sheet.spreadsheetId, email);

    const realId = await getSavedSpreadsheetId(email, "real");
    const testId = await getSavedSpreadsheetId(email, "test");

    return NextResponse.json({
      ok: true,
      connected: true,
      email,
      environment: targetMode,
      sheet: {
        url: sheet.url,
        trades: tradesCount,
        environment: targetMode,
      },
      realSheet: {
        id: realId,
        url: realId ? sheetUrl(realId) : null,
      },
      testSheet: {
        id: testId,
        url: testId ? sheetUrl(testId) : null,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to switch journal environment" },
      { status: 500 }
    );
  }
}
