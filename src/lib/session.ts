/**
 * Signed session cookie.
 *
 * This is a single-user app, so a session means exactly one thing: the
 * allow-listed Google account finished sign-in in this browser. Nothing secret
 * is stored in the cookie — it carries the email in clear text with an HMAC
 * appended. The signature is the point: cookies are editable by whoever owns
 * the browser, and the Google tokens live on the *server*, so without a
 * signature any visitor could claim to be signed in and spend them.
 *
 * Uses Web Crypto rather than `node:crypto` so the same code runs unchanged in
 * middleware, whichever runtime it is given.
 */

export const SESSION_COOKIE = "session";

const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true, // not readable from JavaScript
  secure: process.env.NODE_ENV === "production", // plain http on localhost
  sameSite: "lax",
  path: "/",
  maxAge: MAX_AGE_SECONDS,
} as const;

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    throw new Error(
      'Missing SESSION_SECRET — generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return value;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sign(payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

/** `<email>.<issuedAt>.<signature>` — readable, but only this server can sign it. */
export async function createSession(email: string): Promise<string> {
  const payload = `${email}.${Date.now()}`;
  return `${payload}.${await sign(payload)}`;
}

export async function isValidSession(cookie: string | undefined): Promise<boolean> {
  if (!cookie) return false;

  try {
    // The signature is hex and the timestamp is digits, so cutting at the last
    // two dots is unambiguous even though the email itself contains dots.
    const signatureAt = cookie.lastIndexOf(".");
    if (signatureAt < 0) return false;

    const payload = cookie.slice(0, signatureAt);
    const signature = cookie.slice(signatureAt + 1);

    if (!equalConstantTime(signature, await sign(payload))) return false;

    const issuedAt = Number(payload.slice(payload.lastIndexOf(".") + 1));
    return Number.isFinite(issuedAt) && Date.now() - issuedAt < MAX_AGE_SECONDS * 1000;
  } catch {
    // A missing secret or malformed cookie denies access rather than crashing —
    // failing closed is the only safe direction for an auth check.
    return false;
  }
}

/** Compare without leaking, through timing, how much of the signature was correct. */
function equalConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}
