import type { EconomicEvent } from "@/services/news/calendar";
import { readJson, writeJson } from "@/lib/store";
import { safeEmailKey } from "@/lib/session";

export interface SendAlertParams {
  toEmail: string;
  events: EconomicEvent[];
  brief: string;
  dateLabel: string;
}

export interface SendAlertResult {
  success: boolean;
  messageId?: string;
  previewOnly: boolean;
  error?: string;
  html: string;
}

export async function hasAlertBeenSent(
  userEmail: string,
  eventId: string,
  window: "24h_advance" | "60m_urgent",
): Promise<boolean> {
  const historyKey = `alerts_sent_${safeEmailKey(userEmail)}`;
  const sentList = (await readJson<string[]>(historyKey)) || [];
  const alertId = `${eventId}_${window}`;
  return sentList.includes(alertId);
}

export async function markAlertSent(
  userEmail: string,
  eventId: string,
  window: "24h_advance" | "60m_urgent",
): Promise<void> {
  const historyKey = `alerts_sent_${safeEmailKey(userEmail)}`;
  const sentList = (await readJson<string[]>(historyKey)) || [];
  const alertId = `${eventId}_${window}`;
  if (!sentList.includes(alertId)) {
    sentList.push(alertId);
    await writeJson(historyKey, sentList);
  }
}

// 24-Hour Advance Alert: Minimal, clean, high-impact numbers only.
export function build24hAdvanceEmailHtml(event: EconomicEvent, toEmail: string): { subject: string; html: string } {
  const subject = `Ledgerstone: ${event.title} release tomorrow`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #09090b; font-style: normal;">
  <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
    
    <!-- Header -->
    <div style="margin-bottom: 20px; border-bottom: 1px solid #e2e8f0; padding-bottom: 14px;">
      <div style="font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #2563eb; margin-bottom: 4px;">
        LEDGERSTONE
      </div>
      <div style="display: inline-block; background-color: #f0fdf4; border: 1px solid #bbf7d0; color: #16a34a; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; margin-bottom: 8px;">
        24-Hour Advance Notice
      </div>
      <h1 style="margin: 0 0 4px; font-size: 20px; font-weight: 700; color: #09090b; letter-spacing: -0.2px;">
        ${event.country} ${event.title}
      </h1>
      <p style="margin: 0; font-size: 13px; color: #475569;">
        Scheduled for tomorrow at <strong>${event.formattedTimeIST} IST</strong> (${event.formattedTimeEST} EST)
      </p>
    </div>

    <!-- Core Data Box: Expected vs Previous -->
    <div style="background-color: #fefce8; border: 1px solid #fef08a; border-radius: 6px; padding: 16px 18px; margin-bottom: 20px;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="width: 50%; padding-bottom: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #ca8a04; font-weight: 700;">
            Expected
          </td>
          <td style="width: 50%; padding-bottom: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #ca8a04; font-weight: 700; text-align: right;">
            Previous
          </td>
        </tr>
        <tr>
          <td style="font-size: 24px; font-weight: 800; color: #09090b;">
            ${event.forecast}
          </td>
          <td style="font-size: 24px; font-weight: 800; color: #09090b; text-align: right;">
            ${event.previous}
          </td>
        </tr>
      </table>

      <div style="margin-top: 12px; padding-top: 10px; border-top: 1px solid #fef08a; font-size: 12px; color: #475569;">
        Affected Assets: <strong style="color: #09090b;">${event.affectedAssets.slice(0, 3).join(", ")}</strong>
      </div>
    </div>

    <!-- 1-Sentence Tactical Advisory -->
    <p style="margin: 0 0 20px; font-size: 13px; line-height: 1.5; color: #475569;">
      <strong>Preparation:</strong> Review open positions and key price levels today ahead of potential spread expansion and volatility tomorrow.
    </p>

    <!-- Action Button -->
    <div style="margin-bottom: 20px;">
      <a href="http://localhost:3000" style="display: block; text-align: center; background-color: #2563eb; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 600; padding: 10px 16px; border-radius: 6px;">
        Open Journal
      </a>
    </div>

    <!-- Minimal Footer -->
    <div style="font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 12px; text-align: center;">
      Ledgerstone - Every trade leaves a mark.
    </div>

  </div>
</body>
</html>
  `;

  return { subject, html };
}

/**
 * 60-Minute Urgent Alert: Short, clear, instant visibility.
 * No emojis, no italics, no logos.
 * Colors: White, Black, Blue, Light Green, Yellow.
 */
export function build60mUrgentEmailHtml(event: EconomicEvent, toEmail: string): { subject: string; html: string } {
  const subject = `Ledgerstone: ${event.title} in 1 hour`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #09090b; font-style: normal;">
  <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
    
    <!-- Urgent Header -->
    <div style="margin-bottom: 20px; border-bottom: 1px solid #e2e8f0; padding-bottom: 14px;">
      <div style="font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #2563eb; margin-bottom: 4px;">
        LEDGERSTONE
      </div>
      <div style="display: inline-block; background-color: #fefce8; border: 1px solid #fef08a; color: #ca8a04; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; margin-bottom: 8px;">
        60-Minute Release Notice
      </div>
      <h1 style="margin: 0 0 4px; font-size: 20px; font-weight: 700; color: #09090b; letter-spacing: -0.2px;">
        ${event.country} ${event.title} in 1 Hour
      </h1>
      <p style="margin: 0; font-size: 13px; color: #475569;">
        Release at <strong>${event.formattedTimeIST} IST</strong> (${event.formattedTimeEST} EST)
      </p>
    </div>

    <!-- Core Data Box: Expected vs Previous -->
    <div style="background-color: #fefce8; border: 1px solid #fef08a; border-radius: 6px; padding: 16px 18px; margin-bottom: 20px;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="width: 50%; padding-bottom: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #ca8a04; font-weight: 700;">
            Expected
          </td>
          <td style="width: 50%; padding-bottom: 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #ca8a04; font-weight: 700; text-align: right;">
            Previous
          </td>
        </tr>
        <tr>
          <td style="font-size: 24px; font-weight: 800; color: #09090b;">
            ${event.forecast}
          </td>
          <td style="font-size: 24px; font-weight: 800; color: #09090b; text-align: right;">
            ${event.previous}
          </td>
        </tr>
      </table>

      <div style="margin-top: 12px; padding-top: 10px; border-top: 1px solid #fef08a; font-size: 12px; color: #475569;">
        Prime Impact: <strong style="color: #09090b;">${event.affectedAssets.slice(0, 3).join(", ")}</strong>
      </div>
    </div>

    <!-- 1-Sentence Execution Notice -->
    <p style="margin: 0 0 20px; font-size: 13px; line-height: 1.5; color: #475569;">
      <strong>Execution Notice:</strong> Spreads typically widen before major releases. Use limit orders and maintain strict stop losses.
    </p>

    <!-- Action Button -->
    <div style="margin-bottom: 20px;">
      <a href="http://localhost:3000" style="display: block; text-align: center; background-color: #2563eb; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 600; padding: 10px 16px; border-radius: 6px;">
        Open Journal
      </a>
    </div>

    <!-- Minimal Footer -->
    <div style="font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 12px; text-align: center;">
      Ledgerstone - Every trade leaves a mark.
    </div>

  </div>
</body>
</html>
  `;

  return { subject, html };
}

/**
 * Daily Brief Email: Simple, light, clean.
 * No emojis, no italics, no logos.
 */
export function buildAlertEmailHtml(params: {
  events: EconomicEvent[];
  brief: string;
  dateLabel: string;
  userEmail: string;
}): string {
  const { events, dateLabel } = params;

  const eventList =
    events.length > 0
      ? events
        .map(
          (e) => `
        <div style="padding: 12px 0; border-bottom: 1px solid #e2e8f0;">
          <div style="display: flex; justify-content: space-between; align-items: baseline;">
            <strong style="font-size: 14px; color: #09090b;">${e.country} ${e.title}</strong>
            <span style="font-size: 12px; color: #2563eb; font-weight: 600;">${e.formattedTimeIST} IST</span>
          </div>
          <div style="font-size: 12px; color: #475569; margin-top: 4px;">
            Expected: <strong>${e.forecast}</strong> &nbsp;|&nbsp; Previous: <strong>${e.previous}</strong>
          </div>
        </div>
      `,
        )
        .join("")
      : `<p style="font-size: 13px; color: #475569; margin: 12px 0;">No high-impact releases scheduled today.</p>`;

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ledgerstone: Key market releases</title>
</head>
<body style="margin: 0; padding: 24px 12px; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #09090b; font-style: normal;">
  <div style="max-width: 480px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px;">
    
    <div style="margin-bottom: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 12px;">
      <div style="font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #2563eb; margin-bottom: 4px;">
        LEDGERSTONE
      </div>
      <h1 style="margin: 0 0 4px; font-size: 20px; font-weight: 700; color: #09090b;">
        Today's Key Market News
      </h1>
      <p style="margin: 0; font-size: 12px; color: #475569;">
        ${dateLabel}
      </p>
    </div>

    <!-- Event List -->
    <div style="margin-bottom: 20px;">
      ${eventList}
    </div>

    <div style="margin-bottom: 18px;">
      <a href="http://localhost:3000" style="display: block; text-align: center; background-color: #2563eb; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 600; padding: 10px 16px; border-radius: 6px;">
        Open Journal
      </a>
    </div>

    <div style="font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 12px; text-align: center;">
      Ledgerstone - Every trade leaves a mark.
    </div>

  </div>
</body>
</html>
  `;
}

/**
 * Dispatches a Tier-1 alert email (24h or 60m) to a trader.
 */
export async function sendTier1AlertEmail(params: {
  toEmail: string;
  event: EconomicEvent;
  window: "24h_advance" | "60m_urgent";
}): Promise<SendAlertResult> {
  const { toEmail, event, window } = params;

  const { subject, html } =
    window === "24h_advance"
      ? build24hAdvanceEmailHtml(event, toEmail)
      : build60mUrgentEmailHtml(event, toEmail);

  const resendApiKey = process.env.RESEND_API_KEY;

  if (!resendApiKey) {
    console.log(`[mailer] Resend API key not set. ${window} alert generated in preview mode for: ${toEmail}`);
    return {
      success: true,
      previewOnly: true,
      html,
    };
  }

  try {
    const fromAddress = process.env.EMAIL_FROM || "Ledgerstone <onboarding@resend.dev>";

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [toEmail],
        subject,
        html,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || `Resend error code ${res.status}`);
    }

    console.log(`[mailer] ${window} alert sent to ${toEmail}. Message ID: ${data.id}`);

    return {
      success: true,
      messageId: data.id,
      previewOnly: false,
      html,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Failed to dispatch email";
    console.error(`[mailer] ${window} alert dispatch failed:`, errorMsg);
    return {
      success: false,
      previewOnly: false,
      error: errorMsg,
      html,
    };
  }
}

/**
 * Sends the daily volatility summary email using Resend or preview mode.
 */
export async function sendVolatilityAlertEmail(params: SendAlertParams): Promise<SendAlertResult> {
  const { toEmail, events, brief, dateLabel } = params;
  const html = buildAlertEmailHtml({ events, brief, dateLabel, userEmail: toEmail });
  const subject = `Ledgerstone: Today's key releases (${dateLabel})`;

  const resendApiKey = process.env.RESEND_API_KEY;

  if (!resendApiKey) {
    console.log(`[mailer] Resend API key not configured. Alert email generated in preview mode for: ${toEmail}`);
    return {
      success: true,
      previewOnly: true,
      html,
    };
  }

  try {
    const fromAddress = process.env.EMAIL_FROM || "Ledgerstone <onboarding@resend.dev>";

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [toEmail],
        subject,
        html,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.message || `Resend error code ${res.status}`);
    }

    return {
      success: true,
      messageId: data.id,
      previewOnly: false,
      html,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Failed to send email via Resend";
    return {
      success: false,
      previewOnly: false,
      error: errorMsg,
      html,
    };
  }
}
