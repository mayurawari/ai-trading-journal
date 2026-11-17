import { NextResponse, type NextRequest } from "next/server";
import { getUpcomingAlertEvents, fetchCalendarEvents, isTier1Event } from "@/services/news/calendar";
import { sendTier1AlertEmail, hasAlertBeenSent, markAlertSent } from "@/services/email/mailer";
import { getRegisteredTraders } from "@/services/google/auth";

export const dynamic = "force-dynamic";

/**
 * High-Voltage News Cron:
 * - Scans for Tier-1 catalysts (CPI, FOMC, NFP, GDP, Fed Rate Decisions, Powell).
 * - Sends 24h Advance Warning (1 day prior to release).
 * - Sends 60m Urgent Warning (1 hour prior to release).
 * - Tracks sent status per user to prevent duplicate notifications.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const testMode = searchParams.get("test") as "24h" | "60m" | null;
    const testEmail = searchParams.get("email");

    const registeredTraders = await getRegisteredTraders();
    const recipients = testEmail ? [testEmail] : registeredTraders;

    if (recipients.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "No registered traders to notify.",
      });
    }

    // Manual test mode triggers immediate simulated 24h or 60m alerts
    if (testMode === "24h" || testMode === "60m") {
      const allEvents = await fetchCalendarEvents();
      const sampleEvent = allEvents.find(isTier1Event) || allEvents[0] || {
        id: "sample-cpi",
        title: "Core CPI m/m",
        country: "USD",
        date: new Date(Date.now() + 1000 * 60 * 60 * (testMode === "24h" ? 24 : 1)).toISOString(),
        impact: "High" as const,
        forecast: "0.3%",
        previous: "0.3%",
        affectedAssets: ["Gold (XAUUSD)", "DXY", "US500", "EURUSD"],
        formattedTimeIST: "07:00 PM",
        formattedTimeEST: "08:30 AM",
        isPast: false,
      };

      const window = testMode === "24h" ? "24h_advance" : "60m_urgent";
      const results = [];

      for (const recipient of recipients) {
        const res = await sendTier1AlertEmail({
          toEmail: recipient,
          event: sampleEvent,
          window,
        });
        results.push({ recipient, ...res });
      }

      return NextResponse.json({
        ok: true,
        testMode,
        dispatched: results,
      });
    }

    // Normal Automated Cron Flow
    const upcoming = await getUpcomingAlertEvents();

    if (upcoming.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "No Tier-1 events currently within 24h advance or 60m urgent windows.",
        registeredTradersCount: recipients.length,
      });
    }

    const dispatched = [];

    for (const item of upcoming) {
      for (const trader of recipients) {
        const alreadySent = await hasAlertBeenSent(trader, item.event.id, item.window);

        if (!alreadySent) {
          const res = await sendTier1AlertEmail({
            toEmail: trader,
            event: item.event,
            window: item.window,
          });

          await markAlertSent(trader, item.event.id, item.window);

          dispatched.push({
            trader,
            event: item.event.title,
            window: item.window,
            minutesUntil: item.minutesUntil,
            success: res.success,
            previewOnly: res.previewOnly,
          });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      upcomingTier1Count: upcoming.length,
      dispatchedCount: dispatched.length,
      dispatched,
    });
  } catch (error) {
    console.error("News cron error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Cron execution failed",
      },
      { status: 500 },
    );
  }
}
