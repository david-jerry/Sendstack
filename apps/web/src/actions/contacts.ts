"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@sendstack/auth";
import { db, eq, sql, sqlArray } from "@sendstack/db";
import {
  contactGroupMembers,
  contactGroups,
  contacts,
  inboundEmails,
  listMembers,
  lists,
} from "@sendstack/db/schema";
import {
  addToListSchema,
  contactGroupInputSchema,
  normalizeName,
  contactInputSchema,
  importRowSchema,
  isLikelyValidEmail,
  listInputSchema,
  normalizeEmail,
  slugify,
} from "@sendstack/shared";
import { z } from "zod";

const createContactSchema = contactInputSchema.extend({
  threadMessageId: z.uuid().optional(),
});

export async function createContact(input: unknown) {
  await requireSession();

  const parsed = createContactSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid contact" };
  }

  const { email, firstName, lastName, company, position, phone, listIds, groupIds, threadMessageId } =
    parsed.data;

  const [contact] = await db
    .insert(contacts)
    .values({
      email,
      firstName: firstName || null,
      lastName: lastName || null,
      company: company || null,
      position: position || null,
      phone: phone || null,
      source: "manual",
    })
    // A re-added contact updates their name rather than erroring — but note
    // what is *not* touched: `status`. Re-adding someone who unsubscribed must
    // never quietly resubscribe them.
    .onConflictDoUpdate({
      target: contacts.email,
      set: {
        firstName: firstName || null,
        lastName: lastName || null,
        company: company || null,
        position: position || null,
        phone: phone || null,
        updatedAt: new Date(),
      },
    })
    .returning({ id: contacts.id });

  if (contact && listIds.length > 0) {
    await db
      .insert(listMembers)
      .values(listIds.map((listId) => ({ listId, contactId: contact.id })))
      .onConflictDoNothing();
  }

  if (contact && groupIds.length > 0) {
    await db
      .insert(contactGroupMembers)
      .values(groupIds.map((groupId) => ({ groupId, contactId: contact.id })))
      .onConflictDoNothing();
  }

  if (contact && threadMessageId) {
    await db.execute(sql`
      WITH target AS (
        SELECT thread_key, from_email
        FROM inbound_emails
        WHERE id = ${threadMessageId}::uuid
        LIMIT 1
      )
      UPDATE inbound_emails e
      SET contact_id = ${contact.id}::uuid
      FROM target t
      WHERE e.thread_key = t.thread_key
        AND e.from_email = t.from_email
    `);

    revalidatePath("/inbox");
    revalidatePath(`/inbox/${threadMessageId}`);
  }

  revalidatePath("/contacts");
  return { ok: true as const, id: contact?.id };
}

export type ImportResult = {
  ok: true;
  imported: number;
  skipped: { line: number; value: string; reason: string }[];
};

/**
 * Import contacts from CSV text.
 *
 * Bad rows are *returned*, never silently dropped. An import that reports
 * "1,000 contacts added" while having quietly discarded 400 malformed
 * addresses is how a campaign goes out to a third of its intended audience
 * with nobody noticing until the numbers look wrong a week later.
 */
export async function importContacts(input: {
  csv: string;
  listId?: string | null;
}): Promise<ImportResult | { ok: false; error: string }> {
  await requireSession();

  const lines = input.csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { ok: false as const, error: "The file is empty" };

  // Treat a first row containing "email" as a header rather than data.
  const hasHeader = /email/i.test(lines[0] ?? "");
  const header = hasHeader
    ? (lines[0] ?? "").split(",").map((cell) => cell.trim().toLowerCase())
    : ["email", "first_name", "last_name"];
  const rows = hasHeader ? lines.slice(1) : lines;

  const emailIndex = Math.max(0, header.findIndex((cell) => cell.includes("email")));
  const firstIndex = header.findIndex((cell) => cell.includes("first"));
  const lastIndex = header.findIndex((cell) => cell.includes("last"));

  const valid: { email: string; firstName: string | null; lastName: string | null }[] = [];
  const skipped: ImportResult["skipped"] = [];

  rows.forEach((line, index) => {
    const cells = line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, ""));
    const raw = cells[emailIndex] ?? "";
    const lineNumber = index + (hasHeader ? 2 : 1);

    if (!raw) {
      skipped.push({ line: lineNumber, value: line.slice(0, 60), reason: "No email column" });
      return;
    }
    if (!isLikelyValidEmail(raw)) {
      skipped.push({ line: lineNumber, value: raw, reason: "Not a valid address" });
      return;
    }

    const parsed = importRowSchema.safeParse({
      email: raw,
      firstName: firstIndex >= 0 ? cells[firstIndex] : undefined,
      lastName: lastIndex >= 0 ? cells[lastIndex] : undefined,
    });
    if (!parsed.success) {
      skipped.push({
        line: lineNumber,
        value: raw,
        reason: parsed.error.issues[0]?.message ?? "Invalid row",
      });
      return;
    }

    valid.push({
      email: parsed.data.email,
      firstName: parsed.data.firstName ?? null,
      lastName: parsed.data.lastName ?? null,
    });
  });

  // Duplicates within one file would make the INSERT's ON CONFLICT fire
  // against a row from its own statement, which Postgres rejects outright.
  const deduped = new Map(valid.map((row) => [row.email, row]));

  let imported = 0;
  const batch = Array.from(deduped.values());
  for (let i = 0; i < batch.length; i += 500) {
    const chunk = batch.slice(i, i + 500);
    const inserted = await db
      .insert(contacts)
      .values(chunk.map((row) => ({ ...row, source: "import" })))
      .onConflictDoUpdate({
        target: contacts.email,
        set: { updatedAt: new Date() },
      })
      .returning({ id: contacts.id });

    imported += inserted.length;

    if (input.listId) {
      await db
        .insert(listMembers)
        .values(inserted.map((row) => ({ listId: input.listId!, contactId: row.id })))
        .onConflictDoNothing();
    }
  }

  revalidatePath("/contacts");
  return { ok: true as const, imported, skipped };
}

/**
 * Insert a row under the first slug nothing has taken yet.
 *
 * The slug *rule* is `slugify` in `@sendstack/shared` — this is only the
 * collision retry, and it stays here because it depends on the unique index
 * doing the arbitrating rather than on a check: `ON CONFLICT DO NOTHING`
 * returns no row, so the next suffix is tried. Looking the slug up first and
 * then inserting is the read-then-write two concurrent creates lose.
 *
 * Twenty attempts is a bound rather than a guarantee. Past that the name is
 * pathological — a hundred lists all named with the same emoji — and failing
 * is better than looping until the request times out.
 *
 * `createList` and `createContactGroup` each carried this loop verbatim,
 * differing only in the fallback word.
 */
async function insertWithUniqueSlug<T>(
  name: string,
  fallback: string,
  insert: (slug: string) => Promise<T | undefined>,
): Promise<T | null> {
  const base = slugify(name, fallback);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const row = await insert(slug);
    if (row) return row;
  }
  return null;
}

export async function createList(input: unknown) {
  await requireSession();

  const parsed = listInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid list" };
  }

  const [existing] = Array.from(
    await db.execute<{ id: string; name: string }>(sql`
      SELECT id, name
      FROM lists
      WHERE lower(name) = lower(${parsed.data.name})
      LIMIT 1
    `),
  );

  if (existing) {
    return { ok: true as const, id: existing.id, name: existing.name, created: false as const };
  }

  const created = await insertWithUniqueSlug(parsed.data.name, "list", async (slug) => {
    const [row] = await db
      .insert(lists)
      .values({
        name: parsed.data.name,
        slug,
        description: parsed.data.description || null,
      })
      .onConflictDoNothing()
      .returning({ id: lists.id, name: lists.name });
    return row;
  });

  if (!created) return { ok: false as const, error: "Could not create list" };

  revalidatePath("/lists");
  revalidatePath("/contacts");
  return { ok: true as const, id: created.id, name: created.name, created: true as const };
}

/**
 * Put existing contacts on a list.
 *
 * One statement for however many contacts are chosen — a loop of inserts is
 * the obvious shape and the wrong one, because adding two hundred contacts
 * would be two hundred round trips.
 *
 * `ON CONFLICT DO UPDATE ... SET unsubscribed_at = NULL` rather than
 * `DO NOTHING`: someone who unsubscribed and is being deliberately re-added by
 * an operator should rejoin the list, keeping their original row and its
 * history. It does not touch the suppression list — a bounce or a complaint is
 * not something an operator can undo by re-adding a contact, and the send path
 * checks that separately.
 */
export async function addContactsToList(input: unknown) {
  await requireSession();

  const parsed = addToListSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid selection" };
  }

  const { listId, contactIds } = parsed.data;

  const added = await db.execute<{ contact_id: string }>(sql`
    INSERT INTO list_members (list_id, contact_id)
    SELECT ${listId}::uuid, c.id
    FROM contacts c
    WHERE c.id = ANY(${sqlArray(contactIds, "uuid")})
    ON CONFLICT (list_id, contact_id)
      DO UPDATE SET unsubscribed_at = NULL
    RETURNING contact_id
  `);

  const count = Array.from(added).length;
  if (count === 0) {
    return { ok: false as const, error: "Those contacts no longer exist." };
  }

  revalidatePath("/lists");
  revalidatePath("/contacts");
  return { ok: true as const, added: count };
}

/** Take a contact off a list, keeping the row so history survives. */
export async function removeContactFromList(listId: string, contactId: string) {
  await requireSession();

  await db.execute(sql`
    UPDATE list_members SET unsubscribed_at = now()
    WHERE list_id = ${listId}::uuid AND contact_id = ${contactId}::uuid
      AND unsubscribed_at IS NULL
  `);

  revalidatePath("/lists");
  return { ok: true as const };
}

/**
 * Contacts matching a search, with whether each is already on the list.
 *
 * Answers from the server rather than shipping the whole contact table to the
 * dialog — a mailing tool's contact list is the one table that is reliably
 * large.
 */
export async function searchContactsForList(input: { listId: string; term: string }) {
  await requireSession();

  const term = input.term.trim();
  const pattern = `%${term}%`;

  const rows = await db.execute<{
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    company: string | null;
    on_list: boolean;
  }>(sql`
    SELECT c.id, c.email, c.first_name, c.last_name, c.company,
           EXISTS (
             SELECT 1 FROM list_members lm
             WHERE lm.contact_id = c.id AND lm.list_id = ${input.listId}::uuid
               AND lm.unsubscribed_at IS NULL
           ) AS on_list
    FROM contacts c
    WHERE ${term
      ? sql`(c.email ILIKE ${pattern}
          OR coalesce(c.first_name, '') ILIKE ${pattern}
          OR coalesce(c.last_name, '') ILIKE ${pattern}
          OR coalesce(c.company, '') ILIKE ${pattern})`
      : sql`true`}
    ORDER BY c.created_at DESC
    LIMIT 40
  `);

  return Array.from(rows).map((row) => ({
    id: row.id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    company: row.company,
    onList: row.on_list,
  }));
}

export async function createContactGroup(input: unknown) {
  await requireSession();

  const parsed = contactGroupInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid group" };
  }

  const [existing] = Array.from(
    await db.execute<{ id: string; name: string }>(sql`
      SELECT id, name
      FROM contact_groups
      WHERE lower(name) = lower(${parsed.data.name})
      LIMIT 1
    `),
  );

  if (existing) {
    return { ok: true as const, id: existing.id, name: existing.name, created: false as const };
  }

  const created = await insertWithUniqueSlug(parsed.data.name, "group", async (slug) => {
    const [row] = await db
      .insert(contactGroups)
      .values({
        name: parsed.data.name,
        slug,
        description: parsed.data.description || null,
      })
      .onConflictDoNothing()
      .returning({ id: contactGroups.id, name: contactGroups.name });
    return row;
  });

  if (!created) return { ok: false as const, error: "Could not create group" };

  revalidatePath("/contacts");
  return { ok: true as const, id: created.id, name: created.name, created: true as const };
}

export async function unsubscribeContact(email: string) {
  const address = normalizeEmail(email);
  await db.execute(sql`
    UPDATE contacts
    SET status = 'unsubscribed'::contact_status, unsubscribed_at = now(), updated_at = now()
    WHERE email = ${address}
  `);
  await db.execute(sql`
    INSERT INTO suppressions (email, reason, detail)
    VALUES (${address}, 'unsubscribe'::suppression_reason, 'One-click unsubscribe')
    ON CONFLICT (email) DO NOTHING
  `);
}

/**
 * Patch the contact behind an inbound message, creating one if needed.
 *
 * Takes the whole panel's changed fields in one call rather than one call per
 * field. Four debounced fields saving independently would race on creation —
 * each finding no contact and each inserting one — and the unique index on
 * email would turn a normal edit into an error.
 */
export type InboxContactPatch = {
  name?: string;
  company?: string;
  position?: string;
  phone?: string;
};

export async function updateInboxContact(input: {
  inboundEmailId: string;
  patch: InboxContactPatch;
}): Promise<
  | { ok: true; contactId: string | null; created: boolean; firstName: string | null; lastName: string | null }
  | { ok: false; error: string }
> {
  await requireSession();

  const [message] = await db
    .select({ id: inboundEmails.id, fromEmail: inboundEmails.fromEmail })
    .from(inboundEmails)
    .where(eq(inboundEmails.id, input.inboundEmailId))
    .limit(1);

  if (!message) return { ok: false as const, error: "Message not found" };

  const email = normalizeEmail(message.fromEmail);
  const patch = input.patch;

  // A name is stored as two columns, so a single field has to be split. The
  // first whitespace run separates them, which round-trips every shape people
  // actually type — "Mary Jane Smith" comes back out unchanged.
  let firstName: string | null | undefined;
  let lastName: string | null | undefined;
  if (patch.name !== undefined) {
    const cleaned = normalizeName(patch.name);
    if (cleaned.length === 0) {
      firstName = null;
      lastName = null;
    } else {
      const gap = cleaned.indexOf(" ");
      firstName = gap === -1 ? cleaned : cleaned.slice(0, gap);
      lastName = gap === -1 ? null : cleaned.slice(gap + 1);
    }
  }

  const text = (value: string | undefined) =>
    value === undefined ? undefined : value.trim() || null;

  const fields = {
    ...(firstName !== undefined ? { firstName } : {}),
    ...(lastName !== undefined ? { lastName } : {}),
    ...(patch.company !== undefined ? { company: text(patch.company) } : {}),
    ...(patch.position !== undefined ? { position: text(patch.position) } : {}),
    ...(patch.phone !== undefined ? { phone: text(patch.phone) } : {}),
  };

  const [existing] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.email, email))
    .limit(1);

  // Nothing to store and nobody to store it against: do not conjure a contact
  // record out of an empty field someone clicked into and clicked out of.
  const hasContent = Object.values(fields).some((value) => value !== null && value !== undefined);
  if (!existing && !hasContent) {
    return { ok: true as const, contactId: null, created: false, firstName: null, lastName: null };
  }

  const [row] = await db
    .insert(contacts)
    .values({
      email,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      company: text(patch.company) ?? null,
      position: text(patch.position) ?? null,
      phone: text(patch.phone) ?? null,
      // Distinguishable from an import or a sign-up form: this person wrote to
      // us and someone typed their details in while reading it.
      source: "inbox",
    })
    .onConflictDoUpdate({
      target: contacts.email,
      // Only the fields actually edited. A blanket overwrite would wipe a
      // company set on the Contacts page the moment someone edited a phone
      // number here.
      set: { ...fields, updatedAt: new Date() },
    })
    .returning({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
    });

  if (!row) return { ok: false as const, error: "Could not save the contact" };

  // Link every message from this address, not just the one being read. The
  // sender was the same person in all of them, and the alternative is a
  // thread-by-thread trickle of "Not a contact" for someone plainly known.
  await db
    .update(inboundEmails)
    .set({ contactId: row.id })
    .where(eq(inboundEmails.fromEmail, email));

  revalidatePath("/inbox");
  revalidatePath("/contacts");

  return {
    ok: true as const,
    contactId: row.id,
    created: !existing,
    firstName: row.firstName,
    lastName: row.lastName,
  };
}
