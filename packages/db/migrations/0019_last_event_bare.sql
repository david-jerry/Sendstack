-- Two dialects in one column, reduced to one.
--
-- `outbound_messages.last_event` had two writers that disagreed. The webhook
-- stored Resend's event payload type, which is prefixed — `email.delivered` —
-- and the Sync reconciler stored `emails.list()`'s name for the same thing,
-- which is not. The column therefore held whichever arrived last, and every
-- reader had to strip a prefix that might or might not be there.
--
-- That was three copies of one rule, and one of them broke in production: a
-- client component called the shared `bareEvent` helper, Turbopack resolved
-- the import to a module fragment where the function was not defined, and
-- every thread view threw `bareEvent is not a function`.
--
-- Both writers now normalise at their ingestion boundary. This repairs what
-- the old ones wrote, and the CHECK below is what lets readers trust the
-- column instead of defending against it — a fourth writer fails loudly rather
-- than quietly reintroducing the drift.
UPDATE "outbound_messages"
   SET "last_event" = regexp_replace("last_event", '^email\.', '')
 WHERE "last_event" LIKE 'email.%';
--> statement-breakpoint
-- `NULL NOT LIKE 'email.%'` evaluates to NULL, which satisfies a CHECK, so
-- every row that has no event yet is unaffected and needs no backfill.
--
-- Deliberately *not* applied to `email_events.type`, which stores the same
-- prefixed vocabulary on purpose: that table is the verbatim record of what
-- the provider sent, and nothing reads it to make a decision.
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_last_event_bare" CHECK ("outbound_messages"."last_event" NOT LIKE 'email.%');
