import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, getSessionEmail } from "@/lib/session";
import { getHighImpactEvents, generateAIVolatilityBrief, fetchCalendarEvents, isTier1Event } from "@/services/news/calendar";
import { sendVolatilityAlertEmail, sendTier1AlertEmail } from "@/services/email/mailer";

export const dynamic = "force-dynamic";

/**
 * Sends a High-Voltage Market Volatility Alert email to the current user.
 * Supports:
 * - default: Daily Volatility Radar brief
 * - type === "24h_advance": 1-day prior strategic preparation alert
 * - type === "60m_urgent": 60-minute immediate execution warning
 */
export async function POST(request: NextRequest) {
  try {
    const session = (await cookies()).get(SESSION_COOKIE)?.value;
    const sessionEmail = await getSessionEmail(session);

    let targetEmail = sessionEmail;
    let alertType: "daily_brief" | "24h_advance" | "60m_urgent" = "daily_brief";

    try {
      const body = (await request.json()) as {
        email?: string;
        type?: "daily_brief" | "24h_advance" | "60m_urgent";
      };
      if (body?.email && body.email.includes("@")) {
        targetEmail = body.email.trim().toLowerCase();
      }
      if (body?.type) {
        alertType = body.type;
      }
    } catch {
      // no JSON body
    }

    if (!targetEmail) {
      return NextResponse.json(
        { ok: false, error: "Please sign in with Google to receive email alerts." },
        { status: 401 },
      );
    }

    // Handle 24h Advance or 60m Urgent Alert
    if (alertType === "24h_advance" || alertType === "60m_urgent") {
      const allEvents = await fetchCalendarEvents();
      const targetEvent = allEvents.find(isTier1Event) || allEvents[0] || {
        id: "cpi-sample",
        title: "Core CPI m/m",
        country: "USD",
        date: new Date(Date.now() + 1000 * 60 * 60 * (alertType === "24h_advance" ? 24 : 1)).toISOString(),
        impact: "High" as const,
        forecast: "0.3%",
        previous: "0.3%",
        affectedAssets: ["Gold (XAUUSD)", "DXY", "US500", "EURUSD"],
        formattedTimeIST: "07:00 PM",
        formattedTimeEST: "08:30 AM",
        isPast: false,
      };

      const result = await sendTier1AlertEmail({
        toEmail: targetEmail,
        event: targetEvent,
        window: alertType,
      });

      return NextResponse.json({
        ok: result.success,
        sent: result.success && !result.previewOnly,
        previewOnly: result.previewOnly,
        recipient: targetEmail,
        messageId: result.messageId,
        error: result.error,
        htmlPreview: result.html,
        message: result.previewOnly
          ? `${alertType === "24h_advance" ? "24h Advance" : "60-Min Urgent"} Alert previewed! (Set RESEND_API_KEY in .env to dispatch live)`
          : `${alertType === "24h_advance" ? "24h Advance" : "60-Min Urgent"} alert sent to ${targetEmail}!`,
      });
    }

    // Default Daily Volatility Brief
    const { events, dateLabel } = await getHighImpactEvents();
    const brief = await generateAIVolatilityBrief(events);

    const result = await sendVolatilityAlertEmail({
      toEmail: targetEmail,
      events,
      brief,
      dateLabel,
    });

    return NextResponse.json({
      ok: result.success,
      sent: result.success && !result.previewOnly,
      previewOnly: result.previewOnly,
      recipient: targetEmail,
      messageId: result.messageId,
      error: result.error,
      htmlPreview: result.html,
      message: result.previewOnly
        ? `Alert generated for ${targetEmail} (Resend API key not yet set in .env; email previewed).`
        : `Volatility brief sent to ${targetEmail}! Check your inbox.`,
    });
  } catch (error) {
    console.error("Email dispatch route error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to dispatch email",
      },
      { status: 500 },
    );
  }
}
