import { verifyUnsubscribe } from "@sendstack/email";
import { normalizeEmail } from "@sendstack/shared";
import { unsubscribeContact } from "@/actions/contacts";

export const runtime = "nodejs";

/**
 * The machine-readable half of RFC 8058.
 *
 * Gmail and Yahoo POST here directly when someone uses their built-in
 * unsubscribe button — no browser, no page render. The `List-Unsubscribe-Post`
 * header we attach at send time is what points them at this endpoint, and it
 * only counts as one-click if this responds 200 without a confirmation step.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const email = url.searchParams.get("email");
  const token = url.searchParams.get("token");

  if (!email || !token) return new Response("Missing parameters", { status: 400 });

  const address = normalizeEmail(email);
  if (!verifyUnsubscribe(address, token)) {
    return new Response("Invalid token", { status: 403 });
  }

  await unsubscribeContact(address);
  return new Response("Unsubscribed", { status: 200 });
}
