import { NextResponse, type NextRequest } from "next/server";
import { completeSignIn } from "@/services/google/auth";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  USER_COOKIE,
  USER_COOKIE_OPTIONS,
  createSession,
} from "@/lib/session";

/** Step 2 of sign-in: Google sends the browser back here with a ?code. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const target = new URL("/journal", request.url);

  const denied = params.get("error");
  if (denied) {
    target.searchParams.set("error", denied);
    return NextResponse.redirect(target);
  }

  const code = params.get("code");
  if (!code) {
    target.searchParams.set("error", "Google did not send an authorisation code.");
    return NextResponse.redirect(target);
  }

  try {
    const { email } = await completeSignIn(code);
    target.searchParams.set("connected", "1");

    const response = NextResponse.redirect(target);
    response.cookies.set(SESSION_COOKIE, await createSession(email), SESSION_COOKIE_OPTIONS);
    response.cookies.set(USER_COOKIE, email, USER_COOKIE_OPTIONS);
    return response;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Sign-in failed";
    console.error("[auth] Google sign-in failed:", error);
    target.searchParams.set("error", errorMsg);
    return NextResponse.redirect(target);
  }
}
