import { google } from "googleapis";
import type { NextRequest } from "next/server";
import { readJson, writeJson } from "@/lib/store";
import { safeEmailKey } from "@/lib/session";

/**
 * Derived from `googleapis` rather than imported from `google-auth-library`.
 * npm installs two copies of that package (one nested under googleapis-common),
 * and their OAuth2Client types are not interchangeable. Taking the type from
 * `google.auth.OAuth2` guarantees it is the copy the API clients expect.
 */
export type GoogleOAuthClient = InstanceType<typeof google.auth.OAuth2>;

/**
 * Minimum scopes (ARCHITECTURE.md §7). Both are NON-SENSITIVE, which is the whole
 * point: Google only demands app verification for sensitive/restricted scopes.
 *
 *   drive.file     – only files THIS app created. Not the rest of your Drive.
 *                    The Sheets API accepts this for every call we make (create,
 *                    read, append, format), because we create the spreadsheet
 *                    ourselves. The broad `spreadsheets` scope IS sensitive and
 *                    would force verification — so it is deliberately not here.
 *   userinfo.email – to check the signed-in account against the allow-list.
 */
const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
];

interface StoredTokens {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  email?: string;
}

function cleanEnv(val?: string): string | undefined {
  if (!val) return undefined;
  return val.trim().replace(/^["']|["']$/g, "").trim();
}

function requireEnv(name: string): string {
  const value = cleanEnv(process.env[name]);
  if (!value) throw new Error(`Missing ${name} in environment variables.`);
  return value;
}

export function resolveRedirectUri(request?: NextRequest): string {
  const envUri = cleanEnv(process.env.GOOGLE_REDIRECT_URI);
  // If explicitly configured in production with HTTPS, prioritize it
  if (envUri && envUri.startsWith("https://")) {
    return envUri;
  }

  // Auto-detect from incoming request headers
  if (request) {
    const host =
      request.headers.get("x-forwarded-host") ||
      request.headers.get("host");

    if (host) {
      const isLocal = host.includes("localhost") || host.includes("127.0.0.1");
      // Per Google's OAuth Secure Response Handling policy, non-localhost MUST use https
      const proto = isLocal
        ? (request.headers.get("x-forwarded-proto") || "http")
        : "https";

      return `${proto}://${host}/api/auth/google/callback`;
    }

    const origin = request.nextUrl.origin;
    if (origin) {
      const secureOrigin = origin.includes("localhost")
        ? origin
        : origin.replace(/^http:\/\//i, "https://");
      return `${secureOrigin}/api/auth/google/callback`;
    }
  }

  return envUri || "http://localhost:3000/api/auth/google/callback";
}

export function newClient(customRedirectUri?: string): GoogleOAuthClient {
  const redirectUri =
    customRedirectUri ||
    process.env.GOOGLE_REDIRECT_URI ||
    "http://localhost:3000/api/auth/google/callback";

  return new google.auth.OAuth2(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
    redirectUri,
  );
}

export function getAuthUrl(customRedirectUri?: string): string {
  return newClient(customRedirectUri).generateAuthUrl({
    access_type: "offline", // we need a refresh token so this survives restarts
    prompt: "consent", // force a refresh token even on repeat authorisations
    scope: SCOPES,
  });
}

/** Exchange the ?code from Google for tokens, verify identity, and store them. */
export async function completeSignIn(code: string, customRedirectUri?: string): Promise<{ email: string }> {
  console.log("[auth] Step 1: Exchanging code for Google tokens...");
  const client = newClient(customRedirectUri);
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  console.log("[auth] Step 2: Fetching user profile from Google...");
  const { data } = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
  const email = data.email?.trim().toLowerCase();
  if (!email) throw new Error("Google did not return an email address.");

  console.log("[auth] Step 3: Saving credentials for:", email);
  const userTokenKey = `tokens_${safeEmailKey(email)}`;
  const storedData: StoredTokens = { ...tokens, email };
  await writeJson(userTokenKey, storedData);
  await writeJson("tokens", storedData);

  // Register email for cron alert broadcasts
  const registered = (await readJson<string[]>("registered_traders")) || [];
  if (!registered.includes(email)) {
    await writeJson("registered_traders", [...registered, email]);
  }

  console.log("[auth] Step 4: Sign-in complete for:", email);
  return { email };
}

export async function getRegisteredTraders(): Promise<string[]> {
  const list = (await readJson<string[]>("registered_traders")) || [];
  const defaultTokens = await readJson<StoredTokens>("tokens");
  if (defaultTokens?.email && !list.includes(defaultTokens.email)) {
    list.push(defaultTokens.email);
  }
  return list;
}

export async function getConnectedEmail(userEmail?: string): Promise<string | null> {
  if (userEmail) {
    const userTokens = await readJson<StoredTokens>(`tokens_${safeEmailKey(userEmail)}`);
    if (userTokens?.email) return userTokens.email;
  }
  const tokens = await readJson<StoredTokens>("tokens");
  return tokens?.email ?? null;
}

/**
 * An OAuth client with stored credentials loaded, ready to call Google.
 * Refreshed tokens are written back so the connection keeps working
 * without re-authorising. Scoped per user account.
 */
export async function getAuthedClient(userEmail?: string): Promise<GoogleOAuthClient> {
  const normalizedEmail = userEmail?.trim().toLowerCase();
  const userKey = normalizedEmail ? `tokens_${safeEmailKey(normalizedEmail)}` : "tokens";
  let stored = await readJson<StoredTokens>(userKey);

  if (!stored?.refresh_token && !stored?.access_token) {
    // Fall back to default tokens if user-specific key not yet set or email omitted
    stored = await readJson<StoredTokens>("tokens");
  }

  // Fall back to any registered trader tokens if still empty
  if (!stored?.refresh_token && !stored?.access_token) {
    try {
      const registered = await getRegisteredTraders();
      for (const trader of registered) {
        const traderStored = await readJson<StoredTokens>(`tokens_${safeEmailKey(trader)}`);
        if (traderStored?.refresh_token || traderStored?.access_token) {
          stored = traderStored;
          break;
        }
      }
    } catch {}
  }

  if (!stored?.refresh_token && !stored?.access_token) {
    throw new Error("NOT_CONNECTED");
  }

  const client = newClient();
  client.setCredentials(stored);

  client.on("tokens", async (fresh) => {
    // Google omits refresh_token on refresh responses — keep the original.
    const merged = { ...stored, ...fresh };
    if (!merged.refresh_token) merged.refresh_token = stored.refresh_token;

    if (userEmail) {
      await writeJson(`tokens_${safeEmailKey(userEmail)}`, merged);
    }
    await writeJson("tokens", merged);
  });

  return client;
}

export async function disconnect(userEmail?: string): Promise<void> {
  if (userEmail) {
    await writeJson(`tokens_${safeEmailKey(userEmail)}`, {});
  }
  await writeJson("tokens", {});
}
