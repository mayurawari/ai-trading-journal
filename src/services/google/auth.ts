import { google } from "googleapis";
import { readJson, writeJson } from "@/lib/store";

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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env.local — see BUILD_LOG.md step 1.`);
  return value;
}

function newClient(): GoogleOAuthClient {
  return new google.auth.OAuth2(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
    process.env.GOOGLE_REDIRECT_URI ??
      "http://localhost:3000/api/auth/google/callback",
  );
}

export function getAuthUrl(): string {
  return newClient().generateAuthUrl({
    access_type: "offline", // we need a refresh token so this survives restarts
    prompt: "consent", // force a refresh token even on repeat authorisations
    scope: SCOPES,
  });
}

/** Exchange the ?code from Google for tokens, verify identity, and store them. */
export async function completeSignIn(code: string): Promise<{ email: string }> {
  const client = newClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const { data } = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
  const email = data.email;
  if (!email) throw new Error("Google did not return an email address.");

  // Single-user app: only the allow-listed account may connect (ARCHITECTURE.md §7).
  const allowed = process.env.ALLOWED_GOOGLE_EMAIL?.trim().toLowerCase();
  if (allowed && email.toLowerCase() !== allowed) {
    throw new Error(`${email} is not the allowed account. Expected ${allowed}.`);
  }

  await writeJson("tokens", { ...tokens, email } satisfies StoredTokens);
  return { email };
}

export async function getConnectedEmail(): Promise<string | null> {
  const tokens = await readJson<StoredTokens>("tokens");
  return tokens?.email ?? null;
}

/**
 * An OAuth client with stored credentials loaded, ready to call Google.
 * Refreshed tokens are written back so the connection keeps working
 * without re-authorising.
 */
export async function getAuthedClient(): Promise<GoogleOAuthClient> {
  const stored = await readJson<StoredTokens>("tokens");
  if (!stored?.refresh_token && !stored?.access_token) {
    throw new Error("NOT_CONNECTED");
  }

  const client = newClient();
  client.setCredentials(stored);

  client.on("tokens", async (fresh) => {
    // Google omits refresh_token on refresh responses — keep the original.
    const merged = { ...stored, ...fresh };
    if (!merged.refresh_token) merged.refresh_token = stored.refresh_token;
    await writeJson("tokens", merged);
  });

  return client;
}

export async function disconnect(): Promise<void> {
  await writeJson("tokens", {});
}
