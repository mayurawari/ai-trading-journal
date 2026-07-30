import { NextResponse, type NextRequest } from "next/server";
import { completeSignIn } from "@/services/google/auth";
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS, createSession } from "@/lib/session";

/** Step 2 of sign-in: Google sends the browser back here with a ?code. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const home = new URL("/", request.url);

  const denied = params.get("error");
  if (denied) {
    home.searchParams.set("error", denied);
    return NextResponse.redirect(home);
  }

  const code = params.get("code");
  if (!code) {
    home.searchParams.set("error", "Google did not send an authorisation code.");
    return NextResponse.redirect(home);
  }

  try {
    const { email } = await completeSignIn(code);
    home.searchParams.set("connected", "1");

    // completeSignIn already rejected anyone who is not the allow-listed account,
    // so reaching here is what earns this browser a session.
    const response = NextResponse.redirect(home);
    response.cookies.set(SESSION_COOKIE, await createSession(email), SESSION_COOKIE_OPTIONS);
    return response;
  } catch (error) {
    home.searchParams.set("error", error instanceof Error ? error.message : "Sign-in failed");
    return NextResponse.redirect(home);
  }
}
