import { NextResponse } from "next/server";
import { getHighImpactEvents, generateAIVolatilityBrief } from "@/services/news/calendar";

export const dynamic = "force-dynamic";

/**
 * Returns today's high-impact economic events and AI volatility brief.
 */
export async function GET() {
  try {
    const { events, isToday, dateLabel } = await getHighImpactEvents();
    const brief = await generateAIVolatilityBrief(events);

    return NextResponse.json({
      ok: true,
      events,
      isToday,
      dateLabel,
      brief,
      count: events.length,
    });
  } catch (error) {
    console.error("News API error:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to load market news",
      },
      { status: 500 },
    );
  }
}
