import { NextResponse, type NextRequest } from "next/server";
import { extractTrades } from "@/services/gemini/extract";
import { deriveAll } from "@/core/derive";

export const dynamic = "force-dynamic";

/**
 * Plain text in, structured fields out — one entry per trade described.
 * Writes nothing; saving is a separate step you approve.
 */
export async function POST(request: NextRequest) {
  try {
    const { text } = (await request.json()) as { text?: string };

    if (!text?.trim()) {
      return NextResponse.json({ ok: false, error: "Describe your trade first." }, { status: 400 });
    }

    const trades = await extractTrades(text);

    // Derived values are previewed so risk/reward can be sanity-checked before saving.
    // They get recomputed at save time from whatever you actually confirm.
    return NextResponse.json({
      ok: true,
      trades: trades.map((fields) => ({ fields, derived: deriveAll(fields) })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Extraction failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
