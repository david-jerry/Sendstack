/**
 * What a Resend *account* event means, in one place.
 *
 * Resend posts nineteen webhook event types. Ten of them say nothing about a
 * particular message: a sending domain changed, a contact moved in Resend's
 * own audience, an address entered or left Resend's suppression list. The
 * route stored all of them from the beginning and acted on none, so a domain
 * that stopped verifying — which silently breaks every send — was visible only
 * by querying `email_events` by hand.
 *
 * Three consumers need the same answer about such an event: the webhook route
 * (which publishes it and decides whether it is worth a push notification),
 * the server query that reads the last twenty back out of `email_events`, and
 * the browser that renders them. Describing the payload here rather than at
 * each of those three is the difference between one vocabulary and the three
 * copies `delivery-status.ts` was written to end.
 *
 * Pure on purpose, like its sibling: no drizzle, no database, testable on its
 * own.
 */

import { z } from "zod";
import { normalizeEmail } from "./email-address";
import type { SuppressionReason } from "./enums";

/**
 * The account events we can describe.
 *
 * Deliberately not "every event that is not a delivery event". An unknown
 * `type` must fall through the route's dispatch to the same store-and-200 path
 * a new Resend event has always taken, rather than reaching a describer that
 * returns null and looking like a payload problem.
 */
export const ACCOUNT_EVENT_TYPES = [
  "domain.created",
  "domain.updated",
  "domain.deleted",
  "contact.created",
  "contact.updated",
  "contact.deleted",
  "suppression.added",
  "suppression.removed",
] as const;

export type AccountEventType = (typeof ACCOUNT_EVENT_TYPES)[number];

/**
 * How many account events the Activity feed carries, everywhere.
 *
 * Three places need this number and they must agree: the server query's
 * `LIMIT`, the browser store's cap on live events, and the bell's cap on the
 * merge of the two. Declared once because a store that kept more than the
 * query returns — or a bell that showed more than either holds — is not a
 * bigger feed, it is a feed whose length depends on which half you came
 * through. CLAUDE.md §5: a number that must agree in two packages is declared
 * once and imported.
 */
export const ACCOUNT_ACTIVITY_LIMIT = 20;

export function isAccountEventType(type: string): type is AccountEventType {
  return (ACCOUNT_EVENT_TYPES as readonly string[]).includes(type);
}

export type AccountActivity = {
  kind: AccountEventType;
  /** The domain name or email address the entry is about. */
  subject: string;
  /** One sentence, used by the bell, the toast and the lock screen alike. */
  summary: string;
  /** A same-origin path the entry links to, or null when there is nowhere useful to go. */
  href: string | null;
  /**
   * Why Resend suppressed the address — `bounce`, `complaint`, `manual`, or
   * whatever else it grows.
   *
   * Null for every kind except `suppression.added`, and carried on this type
   * rather than re-read from the payload by the route because the route maps
   * it to one of *our* suppression reasons. Parsing the same field twice, in
   * two files, to answer one question is how the two answers start to differ.
   */
  origin: string | null;
};

/**
 * `data` for a domain event. `status` is optional because a deletion reports
 * the domain that is gone, not the state it was in.
 */
const domainData = z.object({
  name: z.string().min(1),
  status: z.string().min(1).optional(),
});

/** `data` for a contact event. Only the address is needed to describe it. */
const contactData = z.object({
  email: z.string().min(1),
});

const suppressionData = z.object({
  email: z.string().min(1),
  origin: z.string().min(1).optional(),
});

/**
 * Describe an account event, or return null if the payload cannot carry the
 * description.
 *
 * **Null is not an error.** Resend has changed payload shapes before, and a
 * describer that threw would turn a cosmetic surprise into a 500 and put the
 * event back on a ten-hour retry ladder for no possible benefit — see rule 6
 * in the route's docblock. The caller stores the event, skips the entry, and
 * answers 200.
 *
 * Addresses are normalised here, once, so the string the bell shows is
 * byte-identical to the one `suppressions` and `contacts` hold (invariant 6).
 * Domain names are not: they are not addresses, and Resend already reports
 * them lowercased.
 */
export function describeAccountEvent(type: string, data: unknown): AccountActivity | null {
  if (!isAccountEventType(type)) return null;

  if (type === "domain.created" || type === "domain.updated" || type === "domain.deleted") {
    const parsed = domainData.safeParse(data);
    if (!parsed.success) return null;
    const { name, status } = parsed.data;
    const summary =
      type === "domain.created"
        ? `Domain ${name} was added to Resend${status ? ` (${status})` : ""}`
        : type === "domain.updated"
          ? `Domain ${name} is now ${status ?? "changed"}`
          : `Domain ${name} was removed from Resend`;
    return { kind: type, subject: name, summary, href: "/settings?tab=email", origin: null };
  }

  if (type === "contact.created" || type === "contact.updated" || type === "contact.deleted") {
    const parsed = contactData.safeParse(data);
    if (!parsed.success) return null;
    const email = normalizeEmail(parsed.data.email);
    const verb =
      type === "contact.created" ? "created" : type === "contact.updated" ? "updated" : "deleted";
    return {
      kind: type,
      subject: email,
      summary: `Contact ${email} was ${verb} in Resend`,
      href: "/contacts",
      origin: null,
    };
  }

  const parsed = suppressionData.safeParse(data);
  if (!parsed.success) return null;
  const email = normalizeEmail(parsed.data.email);
  const origin = parsed.data.origin ?? null;

  return type === "suppression.added"
    ? {
        kind: type,
        subject: email,
        summary: `${email} was added to Resend's suppression list${origin ? ` (${origin})` : ""}`,
        href: "/suppressions",
        origin,
      }
    : {
        kind: type,
        subject: email,
        summary: `${email} was removed from Resend's suppression list`,
        href: "/suppressions",
        origin: null,
      };
}

/**
 * Resend's suppression origin, translated into one of our reasons.
 *
 * The two vocabularies are not the same size and never will be, so the default
 * matters more than the matches: an origin we have not seen becomes `manual`
 * rather than a bounce. Guessing `hard_bounce` would tell the operator the
 * mailbox is dead on no evidence, and — because `suppress()` writes
 * `contacts.status` for a bounce — would mark the contact bounced too. `manual`
 * suppresses the address either way, which is the part that must not be got
 * wrong; only the explanation degrades.
 *
 * `unsubscribe` is absent deliberately. Resend does not report it as an
 * origin, and an unsubscribe reaching us through our own footer link is
 * already recorded by that path.
 */
export function suppressionReasonFromOrigin(origin: string | null): SuppressionReason {
  switch (origin) {
    case "bounce":
      return "hard_bounce";
    case "complaint":
      return "complaint";
    default:
      return "manual";
  }
}
