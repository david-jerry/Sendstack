import { getSession } from "@sendstack/auth";
import { composeSendSchema, splitAddressList, type TemplateRef } from "@sendstack/shared";
import { sendSingleEmail } from "@/actions/compose";
import { assertNotSuppressed, suppressedMessage } from "@/lib/queries/suppressions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sending one message, over `fetch` rather than as a Server Action.
 *
 * Server Actions cannot be replayed. The action id is generated per build and
 * the payload is an opaque encoded body, so a request captured while offline
 * is meaningless to the next deployment — which makes a queue of them a queue
 * of messages that will never send.
 *
 * A plain JSON endpoint can be stored and retried by anything: the service
 * worker's outbox holds it in IndexedDB, survives the tab being closed and the
 * phone locking, and replays it when the browser reports a network again. That
 * is the whole reason this route exists alongside the action, and both call
 * the same function so there is one send path rather than two.
 *
 * The body is `composeSendSchema` from `@sendstack/shared` — the same schema
 * `queueSend` in the browser builds the body from. It carries a `clientKey`,
 * and `sendSingleEmail` collapses every replay of one key onto one row, so a
 * request the worker sends twice is a message that goes out once.
 */
export async function POST(request: Request) {
  if (!(await getSession())) {
    /**
     * 401, which the worker treats as final.
     *
     * A queued send whose session expired must not be retried forever — the
     * worker drops any 4xx and tells the page, which is how the user finds out
     * rather than wondering where the message went.
     */
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const parsed = composeSendSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "That message is not valid" },
      { status: 400 },
    );
  }

  /**
   * A refusal the caller cannot fix, answered 4xx *before* the send.
   *
   * `isRetryable` in `packages/pwa/src/sw/create.js` retries 5xx, 408 and 429
   * and treats every other status as final, dropping the entry and telling the
   * page. A suppressed recipient is not a transient fault: `sendSingleEmail`
   * refuses it identically on every attempt, so the blanket 502 below made the
   * offline outbox replay a message that could never be accepted until
   * Background Sync gave up — and because the worker only reports a failure on
   * a *non*-retryable status, the person was never told why their reply never
   * left.
   *
   * This does not move the check. `sendSingleEmail` still enforces it, as does
   * every other send path, because invariant 5 belongs in the send path rather
   * than in one of its callers; `assertNotSuppressed` is that single
   * definition and it is called here only to decide which status code the
   * refusal deserves. `splitAddressList` is the same splitter the action uses
   * on the same fields, so the two cannot disagree about what a
   * comma-separated recipient list contains.
   *
   * A suppression added in the gap between this check and the send still comes
   * back 502 and still gets retried — but the retry reaches this check and is
   * dropped with the right answer. The race costs one attempt, not
   * correctness.
   */
  const suppressed = await assertNotSuppressed([
    ...splitAddressList(parsed.data.to),
    ...splitAddressList(parsed.data.cc),
    ...splitAddressList(parsed.data.bcc),
  ]);
  if (suppressed) {
    // 409 rather than 400: the body is well formed and the sender is
    // authorised. What it conflicts with is the do-not-send list, which only
    // an operator can change — so there is nothing to fix in the request, and
    // nothing a retry can do.
    return Response.json({ error: suppressedMessage(suppressed) }, { status: 409 });
  }

  const result = await sendSingleEmail({
    ...parsed.data,
    // The plain-text alternative is optional over the wire but required by the
    // send path, which will not ship a message without one.
    text: parsed.data.text ?? "",
    // Narrowed by the refinement above; the schema keeps it a string.
    template: parsed.data.template as TemplateRef | undefined,
  });

  if (!result.ok) {
    /**
     * 502, not 400.
     *
     * The message parsed and its recipients are sendable, so what is left is
     * the provider or the network — worth retrying. A 4xx here would make the
     * worker drop a message that would have gone out fine a minute later.
     *
     * The one refusal that used to arrive here and had no business being
     * retried is handled above; anything else `sendSingleEmail` reports is
     * either transient or a validation failure `composeSendSchema` has already
     * rejected with a 400.
     */
    return Response.json({ error: result.error }, { status: 502 });
  }

  return Response.json({ ok: true, id: result.id });
}
