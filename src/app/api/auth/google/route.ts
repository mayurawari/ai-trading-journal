import { NextResponse } from "next/server";
import { getAuthUrl } from "@/services/google/auth";

/** Step 1 of sign-in: bounce the browser to Google's consent screen. */
export async function GET() {
  try {
    return NextResponse.redirect(getAuthUrl());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
