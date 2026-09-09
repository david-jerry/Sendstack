import { headers } from "next/headers";
import { getAuth, type Session } from "./server";

/** The current session, or null. Safe in any Server Component or Action. */
export async function getSession(): Promise<Session | null> {
  const auth = await getAuth();
  return auth.api.getSession({ headers: await headers() });
}

/**
 * The current session, or a thrown error.
 *
 * Every Server Action that touches contacts, campaigns, the inbox or settings
 * starts with this. It throws rather than returning null so that forgetting to
 * check the result is a crash and not a silent authorisation bypass — the
 * failure mode of `const session = await getSession()` followed by no `if` is
 * data leaking to an anonymous caller.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}
