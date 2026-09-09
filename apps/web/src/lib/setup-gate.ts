import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getSession, type Session } from "@sendstack/auth";
import { getSetupStateCached } from "./config-cache";

/**
 * Send anyone who lands on the app to the wizard until it is finished.
 *
 * Called from the app and auth layouts rather than from middleware, because
 * middleware runs on the edge runtime where a Postgres connection is not
 * available — and this check is, unavoidably, a database read.
 *
 * Through the per-request cache, because the root layout's `generateMetadata`
 * asks the same question on the same request.
 */
export async function requireSetup(): Promise<void> {
  const state = await getSetupStateCached();
  if (state.stage !== "complete") redirect("/setup");
}

/**
 * Per-request, so a page and the layout above it — or a page and its
 * `generateMetadata` — read the session once between them. Better Auth's
 * cookie cache usually makes the second read free anyway; this makes it free
 * when that cache has just expired too.
 */
const getSessionCached = cache(getSession);

/**
 * A page's own gate, for every screen under `(app)` that reads the database.
 *
 * The layout already redirects anonymous visitors, and that is not enough:
 * Next renders a layout and its page **concurrently**, so the page's queries
 * run — and their results are serialised into the RSC payload — before the
 * layout's redirect is thrown. Every page that touches data therefore has to
 * refuse on its own, first, before any query starts.
 *
 * It redirects rather than calling `requireSession()`, which throws. Both the
 * layout and the page fail on the same request, and two `redirect("/sign-in")`
 * calls agree with each other; a thrown `UNAUTHORIZED` racing a redirect does
 * not — whichever surfaces first wins, and half the time that would be an
 * error page instead of the sign-in form.
 *
 * Setup is checked first for the same reason the layout checks it first: an
 * unconfigured instance has no database to read a session from.
 */
export async function requireAccess(): Promise<Session> {
  await requireSetup();
  const session = await getSessionCached();
  if (!session) redirect("/sign-in");
  return session;
}
