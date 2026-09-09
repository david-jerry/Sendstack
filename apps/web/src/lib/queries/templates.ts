import "server-only";
import { db, eq, sql } from "@sendstack/db";
import { templates } from "@sendstack/db/schema";
import { CUSTOM_TEMPLATE_LIST_LIMIT, type CustomTemplateSummary } from "@sendstack/shared";

/**
 * Every uploaded template, without its HTML.
 *
 * The HTML column is deliberately not selected: a picker shows names, and a
 * dozen 60KB documents on every compose-dialog open would be a megabyte of
 * transfer for a list of twelve labels. `customTemplateHtml()` in the email
 * package fetches one on demand. Ordered case-insensitively to match the
 * unique index on the name, which is also what serves the sort. Capped at
 * `CUSTOM_TEMPLATE_LIST_LIMIT`; the picker says so when the cap is reached.
 */
export async function listCustomTemplates(): Promise<CustomTemplateSummary[]> {
  const rows = await db.execute<{
    id: string;
    name: string;
    description: string | null;
    updated_at: string;
  }>(sql`
    SELECT id, name, description, updated_at
    FROM templates
    ORDER BY lower(name) ASC
    LIMIT ${CUSTOM_TEMPLATE_LIST_LIMIT}
  `);

  return Array.from(rows).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}

/**
 * Store a template, or recognise one already stored.
 *
 * `ON CONFLICT (checksum) DO NOTHING` is the idempotency guarantee: the same
 * HTML uploaded twice — a double-click, a retried request, a second person
 * with the same file — is one row, and the caller is told which existing row
 * it matched rather than shown an error. A name collision is left to surface
 * as a unique violation, because an upsert can only target one constraint and
 * the checksum is the one that has to be silent.
 *
 * In the query module rather than the action so the integration suite can run
 * this exact statement twice and count one row — the action needs a session.
 */
export async function createCustomTemplate(input: {
  name: string;
  description: string | null;
  html: string;
  checksum: string;
  createdBy: string | null;
}): Promise<{ id: string; name: string; existing: boolean } | null> {
  const [created] = await db
    .insert(templates)
    .values(input)
    .onConflictDoNothing({ target: templates.checksum })
    .returning({ id: templates.id, name: templates.name });

  if (created) return { ...created, existing: false };

  const [existing] = await db
    .select({ id: templates.id, name: templates.name })
    .from(templates)
    .where(eq(templates.checksum, input.checksum))
    .limit(1);

  return existing ? { ...existing, existing: true } : null;
}

/**
 * Remove a template unless an unsent campaign depends on it.
 *
 * The guard is inside the DELETE rather than a query before it, so two
 * requests — or a delete racing a campaign being created against the
 * template — cannot interleave between the check and the write. Campaigns
 * already sent are not a reason to refuse: their recipients received the
 * rendered HTML, and the foreign key sets their reference to null.
 *
 * "in_use" and "missing" both come back from a zero-row DELETE and need a
 * second, cheap read to tell apart; they deserve different sentences.
 */
export async function deleteCustomTemplateUnlessInUse(
  id: string,
): Promise<"deleted" | "in_use" | "missing"> {
  const removed = await db.execute<{ id: string }>(sql`
    DELETE FROM templates t
    WHERE t.id = ${id}::uuid
      AND NOT EXISTS (
        SELECT 1 FROM campaigns c
        WHERE c.custom_template_id = t.id
          AND c.status IN ('draft', 'scheduled', 'sending', 'paused')
      )
    RETURNING t.id
  `);
  if (Array.from(removed).length > 0) return "deleted";

  const [still] = await db
    .select({ id: templates.id })
    .from(templates)
    .where(eq(templates.id, id))
    .limit(1);
  return still ? "in_use" : "missing";
}
