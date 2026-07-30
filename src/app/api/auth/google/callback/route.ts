import { NextResponse, type NextRequest } from "next/server";
import { completeSignIn } from "@/services/google/auth";

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
    await completeSignIn(code);
    home.searchParams.set("connected", "1");
  } catch (error) {
    home.searchParams.set("error", error instanceof Error ? error.message : "Sign-in failed");
  }

  return NextResponse.redirect(home);
}
