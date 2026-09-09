import { Inngest, eventType } from "inngest";
import { z } from "zod";
import { getConfig } from "@sendstack/config";

/**
 * Typed event catalogue.
 *
 * Inngest v4 defines events with `eventType(name, { schema })`, and any
 * Standard Schema works — Zod 4 implements it natively, so the same library
 * that validates the forms validates the job payloads.
 *
 * Note the absence of `.default()` anywhere below. Inngest rejects schemas
 * that transform their input (`AssertNoTransform`), because a trigger schema
 * has to describe one fixed wire shape rather than rewrite it. Every field
 * here is therefore required and passed explicitly at the call site.
 */
/**
 * The payload shapes, named separately from the triggers that carry them.
 *
 * `eventType` validates on **send**, which covers the publishers. It does not
 * re-validate on receive, and a function's `event.data` is typed rather than
 * checked — so a payload that did not come from a publisher arrives
 * unexamined. That happens: a replay from the Inngest dashboard can be
 * hand-edited, and a queued event outlives the deploy that wrote it.
 *
 * Holding each schema in a const lets the trigger and `eventData` below share
 * one definition rather than the receive side carrying a second copy that can
 * disagree with the wire format it is meant to describe.
 */
const campaignQueuePayload = z.object({ campaignId: z.uuid() });

const campaignSendPayload = z.object({
  campaignId: z.uuid(),
  /** Increments each time a run hands off to its continuation. */
  pass: z.number().int().min(0),
});

const campaignCancelPayload = z.object({ campaignId: z.uuid() });

const inboundReceivedPayload = z.object({
  providerEmailId: z.string().min(1),
  /**
   * When the provider says the mail arrived. Informational: the job keys
   * on `providerEmailId` alone and never reads this, but it is what makes
   * an event legible in the Inngest dashboard when triaging a stuck row.
   * Optional so a caller without it is not forced to invent one.
   */
  receivedAt: z.string().optional(),
});

export const campaignQueueRequested = eventType("campaign/queue.requested", {
  schema: campaignQueuePayload,
});

export const campaignSendRequested = eventType("campaign/send.requested", {
  schema: campaignSendPayload,
});

export const campaignCancelRequested = eventType("campaign/cancel.requested", {
  schema: campaignCancelPayload,
});

export const inboundReceived = eventType("email/inbound.received", {
  schema: inboundReceivedPayload,
});

/** Every payload schema, by the event name Inngest routes on. */
const payloads = {
  "campaign/queue.requested": campaignQueuePayload,
  "campaign/send.requested": campaignSendPayload,
  "campaign/cancel.requested": campaignCancelPayload,
  "email/inbound.received": inboundReceivedPayload,
} as const;

export type JobEventName = keyof typeof payloads;

/**
 * A function's own payload, parsed rather than assumed.
 *
 * Called at the top of each job in place of destructuring `event.data`. The
 * shape is the same one the trigger declares, so this cannot drift from what
 * senders are held to.
 *
 * It throws, and that is the point: an unparseable payload should stop the run
 * with the field named, not flow onward. Without it a bad `campaignId` reached
 * Postgres and surfaced as `invalid input syntax for type uuid` from inside a
 * transaction three steps down, and a bad `pass` was worse than loud — it is
 * the continuation counter, and a non-number there makes the hand-off
 * arithmetic produce `NaN`, which compares false against every bound and
 * queues another pass for ever.
 *
 * Deliberately *not* a `NonRetriableError`: Inngest's retries are what recover
 * a transient fault, and a malformed payload is not transient — but nor is it
 * this function's business to decide the event should be abandoned. Retrying
 * four times and landing in the dashboard is the behaviour that gets it seen.
 */
export function eventData<Name extends JobEventName>(
  name: Name,
  data: unknown,
): z.infer<(typeof payloads)[Name]> {
  const result = payloads[name].safeParse(data);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`[jobs] ${name} received a payload it cannot use — ${detail}`);
  }
  return result.data as z.infer<(typeof payloads)[Name]>;
}

export const inngest = new Inngest({ id: "sendstack" });

/**
 * Push the stored Inngest keys into the client.
 *
 * The client has to be constructed at module load — every `createFunction`
 * call below depends on it — but its keys now live in the settings table,
 * which cannot be read synchronously. `setEnvVars` exists for exactly this
 * shape of problem (it is how Inngest supports Cloudflare Workers, where env
 * arrives per request), so configuration is applied just before it is needed
 * rather than at import.
 *
 * Call this before `inngest.send()` and in the serve route. It is cheap: the
 * config read is cached, and setting identical values is a no-op.
 */
export async function applyInngestConfig(): Promise<void> {
  try {
    const { inngest: keys } = await getConfig();
    inngest.setEnvVars({
      ...(keys.eventKey ? { INNGEST_EVENT_KEY: keys.eventKey } : {}),
      ...(keys.signingKey ? { INNGEST_SIGNING_KEY: keys.signingKey } : {}),
    });
  } catch (error) {
    // Settings unreadable — during first-run setup, or a database blip. Inngest
    // still falls back to INNGEST_* environment variables, and the local dev
    // server needs no keys at all, so this must not take the endpoint down.
    console.warn("[jobs] could not read Inngest settings; falling back to environment", error);
  }
}

/**
 * Send an event with configuration applied. Prefer this over `inngest.send()`
 * anywhere outside a running function.
 */
export async function sendEvent(...args: Parameters<typeof inngest.send>) {
  await applyInngestConfig();
  return inngest.send(...args);
}
