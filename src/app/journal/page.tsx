import { cookies } from "next/headers";
import { SESSION_COOKIE, getSessionEmail } from "@/lib/session";
import { getActiveEnvironment, getSavedSpreadsheetId, sheetUrl } from "@/services/google/sheets";
import JournalClient, { type ConnectionStatus } from "./JournalClient";

export const dynamic = "force-dynamic";

export default async function JournalPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE)?.value;
  const email = await getSessionEmail(session);

  let initialStatus: ConnectionStatus = {
    connected: false,
    environment: "test",
    sheet: {
      url: "#demo-sheet",
      trades: 0,
      environment: "test",
    },
  };

  if (email) {
    const activeEnv = await getActiveEnvironment(email);
    const realId = await getSavedSpreadsheetId(email, "real");
    const testId = await getSavedSpreadsheetId(email, "test");
    const activeSpreadsheetId = activeEnv === "test" ? testId : realId;

    initialStatus = {
      connected: true,
      email,
      environment: activeEnv,
      sheet: activeSpreadsheetId
        ? {
            url: sheetUrl(activeSpreadsheetId),
            trades: null,
            environment: activeEnv,
          }
        : null,
      realSheet: {
        id: realId,
        url: realId ? sheetUrl(realId) : null,
      },
      testSheet: {
        id: testId,
        url: testId ? sheetUrl(testId) : null,
      },
    };
  }

  return <JournalClient initialStatus={initialStatus} />;
}
