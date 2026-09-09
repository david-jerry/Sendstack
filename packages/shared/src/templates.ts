/**
 * The email designs, and the copy describing them.
 *
 * This lives in shared rather than beside the components in `@sendstack/email`
 * because both sides need it: the renderer picks a component by kind, and the
 * browser needs the names and descriptions to offer a choice. Importing the
 * email package from a client component would pull the renderer — and through
 * it Postgres and Cloudinary — into the browser bundle, which is exactly the
 * build failure this file prevents.
 *
 * The list is the enum in the database (`email_template_kind`, created in
 * `0001_settings_branding_passkey.sql`); adding a design means a migration, an
 * entry here, and a component in the email package. The tuples in `enums.ts`
 * carry the same annotation, for the same reason: the migration is the only
 * place that says which values the database will actually accept.
 */
export const TEMPLATE_KINDS = ["simple", "announcement", "newsletter", "plain"] as const;
export type TemplateKind = (typeof TEMPLATE_KINDS)[number];

/** Shown in every template picker. */
export const TEMPLATE_META: Record<
  TemplateKind,
  { name: string; description: string; bestFor: string }
> = {
  simple: {
    name: "Simple",
    description: "A centred card with your logo, the message, and one button.",
    bestFor: "Most campaigns. The safest choice for deliverability.",
  },
  announcement: {
    name: "Announcement",
    description: "A full-width hero band in your brand colour with the headline reversed out.",
    bestFor: "Launches and product news that should feel like an event.",
  },
  newsletter: {
    name: "Newsletter",
    description: "A masthead and hairline rules separating the content.",
    bestFor: "A recurring digest with several items.",
  },
  plain: {
    name: "Plain",
    description: "Text only — no card, no logo, minimal markup.",
    bestFor: "Anything that should read as a personal note. Best inbox placement.",
  },
};

/**
 * The gate between a submitted string and the `email_template_kind` column.
 *
 * A template choice arrives as `FormData`, so it is `unknown` until something
 * says otherwise, and the column is a Postgres enum: an unchecked value does
 * not fail on the way in, it fails at the `INSERT` with a database error that
 * a settings form cannot show anyone. Checking against `TEMPLATE_KINDS` means
 * the list the migration created is the list the check enforces, so adding a
 * design cannot leave this behind.
 */
export function isTemplateKind(value: unknown): value is TemplateKind {
  return typeof value === "string" && (TEMPLATE_KINDS as readonly string[]).includes(value);
}
