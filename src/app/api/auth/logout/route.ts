import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  USER_COOKIE,
  USER_COOKIE_OPTIONS,
} from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: 0,
  });
  response.cookies.set(USER_COOKIE, "", {
    ...USER_COOKIE_OPTIONS,
    maxAge: 0,
  });
  return response;
}
