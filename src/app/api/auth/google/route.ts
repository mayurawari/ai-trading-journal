import { NextResponse, type NextRequest } from "next/server";
import { getAuthUrl, resolveRedirectUri } from "@/services/google/auth";

export const dynamic = "force-dynamic";

/** Step 1 of sign-in: bounce the browser to Google's consent screen. */
export async function GET(request: NextRequest) {
  try {
    const redirectUri = resolveRedirectUri(request);
    return NextResponse.redirect(getAuthUrl(redirectUri));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
