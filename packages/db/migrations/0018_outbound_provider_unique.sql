-- Addresses stored with their display name still attached.
--
-- `syncSentEmails` passed the provider's raw `From`/`To` *header* values to
-- `normalizeEmail`, which only lowercases and trims — so a header like
-- `"Acme" <hello@acme.com>` was stored verbatim as the address. Three things
-- broke: Sent and the thread view render the junk as the address; the
-- thread-rejoin lookup compares it against a correctly parsed
-- `inbound_emails.from_email` and never matches, so recovered replies stand
-- alone; and any future join to `contacts` or `suppressions` misses.
--
-- The code now uses `parseAddress`. This repairs what the old path wrote.
-- `substring(… from '<([^>]*)>')` yields the bracketed address, and COALESCE
-- leaves an already-clean value alone.
UPDATE "outbound_messages" SET
  "from_email" = lower(btrim(COALESCE(substring("from_email" from '<([^>]*)>'), "from_email"))),
  "to_emails" = ARRAY(
    SELECT lower(btrim(COALESCE(substring(t from '<([^>]*)>'), t))) FROM unnest("to_emails") AS t
  ),
  "cc_emails" = ARRAY(
    SELECT lower(btrim(COALESCE(substring(t from '<([^>]*)>'), t))) FROM unnest("cc_emails") AS t
  )
WHERE "from_email" LIKE '%<%'
   OR EXISTS (SELECT 1 FROM unnest("to_emails") t WHERE t LIKE '%<%')
   OR EXISTS (SELECT 1 FROM unnest("cc_emails") t WHERE t LIKE '%<%');
--> statement-breakpoint
-- The same fault, with a worse consequence: the webhook wrote an unparsed
-- address into `suppressions`, so a complaint recorded a row that can never
-- match and the address that actually complained was never suppressed. The
-- bracketed address is recoverable from the junk row, so this genuinely
-- suppresses those people rather than only tidying up. `DO NOTHING` covers a
-- clean row already existing for the same address.
INSERT INTO "suppressions" ("email", "reason", "detail", "source_event_id", "expires_at", "created_at")
SELECT lower(btrim(substring("email" from '<([^>]*)>'))), "reason", "detail",
       "source_event_id", "expires_at", "created_at"
FROM "suppressions"
WHERE "email" LIKE '%<%' AND substring("email" from '<([^>]*)>') IS NOT NULL
ON CONFLICT ("email") DO NOTHING;
--> statement-breakpoint
DELETE FROM "suppressions" WHERE "email" LIKE '%<%';
--> statement-breakpoint
-- Duplicate imports, which have to go before the unique index can be created.
--
-- `syncSentEmails`' `ON CONFLICT DO NOTHING` had no arbiter index it could
-- use, so it was dead: the Sync button pressed twice, or pressed while the
-- hourly cron ran, imported the same provider message more than once. The
-- earliest row is kept because it is the one any `email_events` row and any
-- realtime event already referred to.
DELETE FROM "outbound_messages" a
USING "outbound_messages" b
WHERE a."provider_message_id" IS NOT NULL
  AND a."provider_message_id" = b."provider_message_id"
  AND (a."created_at", a."id") > (b."created_at", b."id");
--> statement-breakpoint
DROP INDEX "outbound_provider_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_provider_key" ON "outbound_messages" USING btree ("provider_message_id") WHERE "outbound_messages"."provider_message_id" IS NOT NULL;
