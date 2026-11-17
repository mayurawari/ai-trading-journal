import { cookies } from "next/headers";
import { SESSION_COOKIE, getSessionEmail } from "@/lib/session";
import HomepageClient, { type ConnectionStatus } from "./HomepageClient";

export const dynamic = "force-dynamic";

export default async function Page() {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE)?.value;
  const email = await getSessionEmail(session);

  const initialStatus: ConnectionStatus = {
    connected: Boolean(email),
    email: email || undefined,
  };

  return <HomepageClient initialStatus={initialStatus} />;
}
