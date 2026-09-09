/**
 * The one place a provider delivery event becomes one of our statuses.
 *
 * Three consumers apply these events — the webhook route, the sent-mail
 * reconciler, and the send worker's own post-send write — and before this file
 * each carried its own copy of the mapping and its own copy of the "never move
 * backwards" ladder. They had already drifted: the route dropped
 * `delivery_delayed` on the floor, and a complaint became `sent` in one place
 * and `failed` in another. Two implementations of one rule is the defect; this
 * is the single definition, and the SQL `CASE` the consumers run is *generated*
 * from it rather than written beside it.
 *
 * Pure on purpose. `@sendstack/shared` has no drizzle, so the SQL generator
 * lives in `@sendstack/jobs`; what lives here is the rule, testable without a
 * database.
 */

import {
  OUTBOUND_STATUSES,
  RECIPIENT_STATUSES,
  type OutboundStatus,
  type RecipientStatus,
} from "./enums";

// The status vocabularies live in `enums.ts`, beside every other database
// enum, so this file adds the rule and not a second copy of the list.
export { OUTBOUND_STATUSES, RECIPIENT_STATUSES, type OutboundStatus, type RecipientStatus };

/**
 * The delivery events Resend posts to the webhook, minus the `email.` prefix.
 *
 * `emails.list()` reports a wider `last_event` vocabulary — `queued`,
 * `scheduled`, `canceled`, `suppressed` — which the maps below also cover, but
 * only these eight arrive by webhook and only these carry a recipient state.
 */
export const DELIVERY_EVENT_NAMES = [
  "sent",
  "delivered",
  "delivery_delayed",
  "opened",
  "clicked",
  "bounced",
  "complained",
  "failed",
] as const;

export type DeliveryEventName = (typeof DELIVERY_EVENT_NAMES)[number];

/**
 * Resend's event vocabulary against a campaign recipient, which tracks the
 * whole funnel.
 *
 * `delivery_delayed` is `sent`, not `failed`: it is transient, and calling it
 * a failure would suppress an address that is fine. `canceled` and
 * `suppressed` are `failed` because from the sender's side that is what they
 * are — the message did not go.
 */
const RECIPIENT_STATUS_BY_EVENT: Record<string, RecipientStatus> = {
  queued: "sending",
  scheduled: "sending",
  delivery_delayed: "sent",
  sent: "sent",
  delivered: "delivered",
  opened: "opened",
  clicked: "clicked",
  bounced: "bounced",
  complained: "complained",
  failed: "failed",
  canceled: "failed",
  suppressed: "failed",
};

/**
 * The same vocabulary against a one-off message, whose status is *our* send
 * lifecycle rather than the recipient's engagement: an opened message is still
 * a sent one.
 *
 * Two choices worth stating:
 *
 *  - `complained` is `failed`. A complaint means the address must never be
 *    mailed again, and a thread that shows the reply as cleanly `sent` hides
 *    exactly the fact the sender most needs. The route used to say `sent` and
 *    the reconciler `failed`; this is the deliberate resolution.
 *  - `delivery_delayed` is `sent`. `sent` here means "the provider has it and
 *    has attempted delivery"; a deferral by the receiving server happens after
 *    that point. `queued`/`scheduled` are the provider's own pre-send states
 *    and stay `queued`.
 */
const OUTBOUND_STATUS_BY_EVENT: Record<string, OutboundStatus> = {
  queued: "queued",
  scheduled: "queued",
  delivery_delayed: "sent",
  sent: "sent",
  delivered: "sent",
  opened: "sent",
  clicked: "sent",
  bounced: "failed",
  complained: "failed",
  failed: "failed",
  canceled: "failed",
  suppressed: "failed",
};

/**
 * `email.delivered` and `delivered` are the same event; callers use both forms.
 *
 * Both dialects are genuinely stored. The webhook writes
 * `outbound_messages.last_event` from Resend's event payload, which is
 * prefixed; the Sync reconciler writes the same column from `emails.list()`,
 * which is not. So anything reading that column back — a realtime publish, a
 * rendered label — has to strip the prefix, and this was written out a third
 * time in the webhook route and a fourth in `message-card.tsx` before it was
 * exported from here.
 */
export function bareEvent(event: string): string {
  return event.startsWith("email.") ? event.slice("email.".length) : event;
}

/**
 * Whether a stored event is one of the eight the webhook vocabulary carries.
 *
 * Needed because `last_event` holds a wider set than `DELIVERY_EVENT_NAMES`:
 * `emails.list()` also reports `queued`, `scheduled`, `canceled` and
 * `suppressed`, and the reconciler stores whichever it was given. A consumer
 * typed to the eight — the `outbound.updated` realtime event, for one — must
 * therefore narrow rather than cast, or it publishes a value its own schema
 * rejects and the browser drops the update silently.
 */
export function isDeliveryEventName(event: string): event is DeliveryEventName {
  return (DELIVERY_EVENT_NAMES as readonly string[]).includes(bareEvent(event));
}

/**
 * The recipient status a provider event asserts, before the ladder is applied.
 *
 * An unknown event means Resend added one we have not seen. `sent` is the
 * safe direction: the message did leave, and a later event or sync corrects
 * the row once the mapping is updated. Marking it `failed` would suppress
 * nothing but would lie on the dashboard.
 */
export function recipientStatusForEvent(event: string): RecipientStatus {
  return RECIPIENT_STATUS_BY_EVENT[bareEvent(event)] ?? "sent";
}

/** The outbound status a provider event asserts. Same unknown-event rule. */
export function outboundStatusForEvent(event: string): OutboundStatus {
  return OUTBOUND_STATUS_BY_EVENT[bareEvent(event)] ?? "sent";
}

/**
 * Terminal for the recipient: nothing arriving afterwards may overwrite these.
 * Opens and clicks routinely arrive after — and are weaker than — a bounce,
 * and a click must never erase the bounce that says the address is dead.
 */
type RecipientTerminal = "bounced" | "complained" | "failed";
const RECIPIENT_TERMINAL = new Set<RecipientStatus>(["bounced", "complained", "failed"]);

function isRecipientTerminal(status: RecipientStatus): status is RecipientTerminal {
  return RECIPIENT_TERMINAL.has(status);
}

/**
 * How far along the funnel each non-terminal status is. A row only ever moves
 * to a higher rank, so a late `sent` cannot undo a `delivered`, and a
 * reconciler reporting `queued` cannot drag a delivered row back to `sending`
 * — which the hand-written `CASE` this replaced did allow.
 *
 * `suppressed` and `cancelled` sit at the bottom deliberately: a delivery
 * event for such a row is proof the message actually went, and the row should
 * say so rather than keep a state the provider has contradicted.
 */
const RECIPIENT_RANK: Record<Exclude<RecipientStatus, RecipientTerminal>, number> = {
  pending: 0,
  suppressed: 0,
  cancelled: 0,
  sending: 1,
  sent: 2,
  delivered: 3,
  opened: 4,
  clicked: 5,
};

/**
 * The status a recipient row should hold after `incoming` is applied to
 * `current`. Monotonic: the result is never earlier in the funnel than
 * `current`, and a terminal `current` is never changed.
 */
export function nextRecipientStatus(
  current: RecipientStatus,
  incoming: RecipientStatus,
): RecipientStatus {
  if (isRecipientTerminal(current)) return current;
  if (isRecipientTerminal(incoming)) return incoming;
  return RECIPIENT_RANK[incoming] > RECIPIENT_RANK[current] ? incoming : current;
}

/**
 * Every event name the `last_event` column can hold.
 *
 * Wider than `DELIVERY_EVENT_NAMES`, which is only what arrives by webhook:
 * the Sync reconciler writes whatever `emails.list()` reports, which adds the
 * provider's own pre-send and cancelled states. Derived from the map rather
 * than hand-listed, because a second copy of a vocabulary is exactly the drift
 * CLAUDE.md §5 names — and this list already existed twice, once here as prose
 * in a docblock and once as the set of keys below it.
 */
export const PROVIDER_EVENT_NAMES = Object.keys(RECIPIENT_STATUS_BY_EVENT);

/**
 * Whether `incoming` may replace `stored` as a row's `last_event`.
 *
 * **This is the funnel order, and it is deliberately not the one that guards
 * `status`.** The outbound ladder collapses `sent`, `delivery_delayed`,
 * `delivered`, `opened` and `clicked` into the single status `sent`, so it
 * cannot tell them apart — `nextOutboundStatus("sent","sent")` returns `sent`,
 * which equals the incoming value, so a status-based guard accepts any of them
 * over any other. That is why a retried `email.delivered` landing after
 * `email.clicked` relabelled a row "Delivered": Resend retries on a
 * 5s/5m/30m/2h/5h/10h ladder and each attempt carries a fresh `svix-id`, so no
 * dedupe guard applies either.
 *
 * The recipient ladder *does* rank the funnel — `delivered` 3, `opened` 4,
 * `clicked` 5 — so this reuses it rather than introducing a second ranking
 * beside it. `nextRecipientStatus(from, to) !== from` rather than `=== to`,
 * because that is what makes an **identical** repeated event refuse: a webhook
 * retry must not bump `last_event_at` and claim the stored event arrived later
 * than it did.
 *
 * **Callers must AND this with the status ladder, never substitute it.** On
 * its own it lets a row our own send path gave up on — `status='failed'` with
 * no event stored, which `sendSingleEmail`'s failure branch writes — accept a
 * later `delivered`, because `null` always advances. The thread view then
 * draws a red failed bubble carrying a green "Delivered" badge. The status
 * ladder contributes "a failure is never overwritten by a non-failure"; this
 * contributes the order inside the sent band; `last_event` has to satisfy both
 * because the UI renders the two columns side by side.
 */
export function eventAdvances(stored: string | null | undefined, incoming: string): boolean {
  if (!stored) return true;

  const from = recipientStatusForEvent(stored);
  const to = recipientStatusForEvent(incoming);

  /**
   * Same rung, different event: advance.
   *
   * `sent` and `delivery_delayed` both map to the recipient status `sent`, and
   * `email.sent` always arrives first — so the strict rule would refuse every
   * `delivery_delayed` and make the "Delayed" badge in `message-card.tsx`
   * permanently unreachable. `queued`/`scheduled` share a rung for the same
   * reason. Terminal pairs are excluded so the *first* failure sticks, which
   * matches how `error` is written first-wins.
   */
  if (from === to) {
    return bareEvent(stored) !== bareEvent(incoming) && !RECIPIENT_TERMINAL.has(from);
  }

  return nextRecipientStatus(from, to) !== from;
}

const OUTBOUND_RANK: Record<Exclude<OutboundStatus, "failed">, number> = {
  draft: 0,
  queued: 1,
  sent: 2,
};

/**
 * The same ladder for a one-off message. `failed` is terminal in both
 * directions — once failed it stays failed, and a failure always wins over
 * the lifecycle states — so a bounce arriving after our own optimistic `sent`
 * write is kept, and an `opened` arriving after that bounce is not.
 */
export function nextOutboundStatus(current: OutboundStatus, incoming: OutboundStatus): OutboundStatus {
  if (current === "failed" || incoming === "failed") return "failed";
  return OUTBOUND_RANK[incoming] > OUTBOUND_RANK[current] ? incoming : current;
}
