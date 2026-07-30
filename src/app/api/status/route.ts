import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getConnectedEmail } from "@/services/google/auth";
import { countTrades, getSavedSpreadsheetId, sheetUrl } from "@/services/google/sheets";
import { SESSION_COOKIE, isValidSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Everything the home page needs to describe the current setup. */
export async function GET() {
  // Open to everyone so the page can offer its sign-in button, but a visitor
  // without a session learns nothing about the account or the sheet.
  const session = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await isValidSession(session))) {
    return NextResponse.json({ connected: false });
  }

  const email = await getConnectedEmail();
  if (!email) {
    return NextResponse.json({ connected: false });
  }

  const spreadsheetId = await getSavedSpreadsheetId();
  if (!spreadsheetId) {
    return NextResponse.json({ connected: true, email, sheet: null });
  }

  try {
    return NextResponse.json({
      connected: true,
      email,
      sheet: {
        url: sheetUrl(spreadsheetId),
        trades: await countTrades(spreadsheetId),
      },
    });
  } catch (error) {
    return NextResponse.json({
      connected: true,
      email,
      sheet: { url: sheetUrl(spreadsheetId), trades: null },
      warning: error instanceof Error ? error.message : "Could not read the sheet",
    });
  }
}
