"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@sendstack/auth";
import { isUniqueViolation } from "@sendstack/db";
import {
  customTemplateInputSchema,
  validateCustomTemplate,
  type CustomTemplateSummary,
} from "@sendstack/shared";
import {
  createCustomTemplate,
  deleteCustomTemplateUnlessInUse,
  listCustomTemplates,
} from "@/lib/queries/templates";

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

export type UploadTemplateResult =
  | { ok: true; id: string; name: string; existing: boolean }
  /** `errors` is the full list from the validator; `error` is the first of them. */
  | { ok: false; error: string; errors?: string[] };

/**
 * The uploaded templates, for a picker in a client component.
 *
 * A thin action over the server-only query so the compose dialog — which is
 * mounted once, above every page — can ask for the list when it opens rather
 * than having every page pass it down through props it does not otherwise use.
 */
export async function fetchCustomTemplates(): Promise<CustomTemplateSummary[]> {
  await requireSession();
  return listCustomTemplates();
}

/**
 * Store an uploaded template.
 *
 * Validation runs the same `validateCustomTemplate` the form ran, on the
 * server's copy of the HTML. Every error is returned rather than the first,
 * so a template with three problems is fixed in one round trip.
 *
 * Idempotency lives in `createCustomTemplate` and the schema beneath it: the
 * same HTML twice is one row, reported here as "already uploaded" rather than
 * as a failure, because a double-clicked Upload button should look like it
 * worked once. A duplicate *name* is a real conflict and is said so.
 */
export async function uploadCustomTemplate(input: unknown): Promise<UploadTemplateResult> {
  const session = await requireSession();

  // Line endings are normalised before both validation and hashing, so the
  // same file saved on Windows and on a Mac is one template, and what is
  // hashed is exactly what is stored.
  const raw =
    typeof input === "object" && input !== null && typeof (input as { html?: unknown }).html === "string"
      ? (input as { html: string }).html.replace(/\r\n?/g, "\n").trim()
      : "";
  const parsed = customTemplateInputSchema.safeParse({ ...(input as object), html: raw });
  if (!parsed.success) {
    const check = validateCustomTemplate(raw);
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "That template is not valid.",
      errors: check.ok ? [] : check.errors,
    };
  }

  const { name, description, html } = parsed.data;
  const checksum = createHash("sha256").update(html).digest("hex");

  let stored: Awaited<ReturnType<typeof createCustomTemplate>>;
  try {
    stored = await createCustomTemplate({
      name,
      description: description || null,
      html,
      checksum,
      createdBy: session.user.id,
    });
  } catch (error) {
    // 23505 is unique_violation. Only the name index can raise it here — the
    // checksum conflict is absorbed by the statement itself.
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        error: `A template named “${name}” already exists. Choose another name, or delete that one first.`,
      };
    }
    throw error;
  }

  if (!stored) return { ok: false, error: "Could not store that template." };
  if (!stored.existing) revalidatePath("/settings");
  return { ok: true, ...stored };
}

/** Remove an uploaded template. Refused while an unsent campaign uses it. */
export async function deleteCustomTemplate(id: unknown): Promise<Result> {
  await requireSession();

  // Narrowed before it reaches a `::uuid` cast: a tampered id would otherwise
  // surface as a Postgres syntax error, which is a 500 rather than an answer.
  const parsedId = z.uuid().safeParse(id);
  if (!parsedId.success) return { ok: false, error: "That template was already deleted." };

  const outcome = await deleteCustomTemplateUnlessInUse(parsedId.data);
  if (outcome === "deleted") {
    revalidatePath("/settings");
    return { ok: true };
  }
  if (outcome === "in_use") {
    return {
      ok: false,
      error: "A draft or scheduled campaign uses this template. Send or delete that campaign first.",
    };
  }
  return { ok: false, error: "That template was already deleted." };
}
