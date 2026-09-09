import { MERGE_FIELDS } from "./merge-fields";
import { TEMPLATE_KINDS, type TemplateKind } from "./templates";

/**
 * The contract an uploaded HTML template has to meet, defined once.
 *
 * Separate from `templates.ts` because that file is the closed list of designs
 * shipped with the app, and this is the opposite: what an operator's own HTML
 * must contain to be rendered by the same pipeline. Three things read this
 * contract and have to agree or a template silently renders wrong — the
 * validator that accepts an upload, the renderer that fills the slots, and the
 * prompt handed to whoever (or whatever) writes the HTML. Keeping the slot
 * list in one place is what stops the prompt promising a `{{ logoUrl }}` the
 * renderer never supplies.
 */

/**
 * Upper bound on an uploaded template, in bytes.
 *
 * Deliberately far below what Postgres or a Server Action could carry: Gmail
 * clips any message over about 102KB and shows "[Message clipped]" instead of
 * the footer — which is where the unsubscribe link lives. A template is only
 * part of the final message, so the prompt tells authors to stay under 100KB
 * total, and this cap catches the upload that is a whole website by mistake.
 */
export const MAX_CUSTOM_TEMPLATE_BYTES = 256 * 1024;

export const CUSTOM_TEMPLATE_NAME_MAX = 80;
export const CUSTOM_TEMPLATE_DESCRIPTION_MAX = 200;

/**
 * How many uploaded templates a picker will list.
 *
 * Not a page size — there is no cursor, on purpose. A workspace has a handful
 * of designs, not a feed of them, and a picker with a "load more" is a picker
 * nobody can find anything in. The cap exists so a runaway import script
 * cannot turn the compose dialog into a 40,000-row query, and the picker says
 * when it has been hit rather than pretending the list is complete.
 */
export const CUSTOM_TEMPLATE_LIST_LIMIT = 200;

export type TemplateSlot = {
  name: string;
  /** What the renderer puts there, in words an author can act on. */
  description: string;
  /** Validation refuses an upload that leaves this out. */
  required?: boolean;
  /**
   * Inserted as raw HTML with three braces. Only the body: everything else is
   * text and is HTML-escaped on the way in, so a subject line containing `<`
   * cannot break the markup around it.
   */
  raw?: boolean;
};

/** The one slot inserted without escaping. Referenced by name in the renderer. */
export const BODY_SLOT = "body";

export const CUSTOM_TEMPLATE_SLOTS: TemplateSlot[] = [
  {
    name: BODY_SLOT,
    required: true,
    raw: true,
    description:
      "The message written in the composer, already HTML. Exactly once, as {{{ body }}} with three braces so it is inserted as markup rather than escaped text.",
  },
  {
    name: "subject",
    description: "The subject line, for a heading inside the message.",
  },
  {
    name: "preheader",
    description:
      "The preview text shown beside the subject in an inbox list. Empty when the sender set none, so wrap it in {{#if preheader}}…{{/if}}.",
  },
  {
    name: "unsubscribeUrl",
    required: true,
    description:
      "A per-recipient unsubscribe link on bulk mail. Empty on one-to-one mail, so wrap the footer link in {{#if unsubscribeUrl}}…{{/if}} — a personal note should not carry an unsubscribe line.",
  },
  {
    name: "appName",
    description: "The workspace name from Settings → Workspace.",
  },
  {
    name: "appUrl",
    description: "The public URL of this instance, for a logo link or a “view online” link.",
  },
  {
    name: "logoUrl",
    description:
      "An absolute URL to the uploaded logo. Empty when none is uploaded, so wrap the <img> in {{#if logoUrl}}…{{/if}} and fall back to {{ appName }} as text.",
  },
  {
    name: "primaryColor",
    description: "The brand colour from Settings, as a six-digit hex value like #1d4ed8.",
  },
  {
    name: "postalAddress",
    description:
      "The sender's physical address. Print it under the unsubscribe link — CAN-SPAM requires it on commercial mail. Empty when none is set, so wrap it in {{#if postalAddress}}…{{/if}}.",
  },
];

const SLOT_NAMES = new Set(CUSTOM_TEMPLATE_SLOTS.map((slot) => slot.name));
const MERGE_TAGS = new Set(MERGE_FIELDS.map((field) => field.tag));

/**
 * Whether a placeholder name is something the renderer will populate.
 *
 * Recipient merge fields are allowed alongside the slots: a campaign renders
 * the template once per recipient, so `{{ firstName }}` in a hero heading is
 * a legitimate thing to want. `attributes.*` is open-ended by design — the
 * same rule `unresolvableTags` applies to a message body.
 */
export function isKnownTemplatePlaceholder(name: string): boolean {
  return SLOT_NAMES.has(name) || MERGE_TAGS.has(name) || name.startsWith("attributes.");
}

// ─── References ──────────────────────────────────────────────────────────────

/**
 * Which design a message uses: a built-in kind, or an uploaded template by id.
 *
 * A string rather than a discriminated object because it travels as one: React
 * state in the picker, a JSON field in the offline outbox, a query parameter
 * on the preview route, a column-pair on a campaign. Encoding it once and
 * parsing it once beats four shapes that have to be kept in step.
 */
export type TemplateRef = TemplateKind | `custom:${string}`;

export const CUSTOM_TEMPLATE_PREFIX = "custom:";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Encode an uploaded template's id as a reference.
 *
 * The prefix appears here and in `parseTemplateRef`, and nowhere else — a
 * picker or a preview link building `` `custom:${id}` `` itself is how the two
 * come to disagree about a separator that only shows up as "unknown template"
 * much later.
 *
 * Note the asymmetry with its inverse: this validates nothing, while
 * `parseTemplateRef` insists on a UUID. Intentional. Ids handed to this come
 * from a row that already exists, whereas a reference handed to that one came
 * off a query string or an offline queue and must not be allowed to select a
 * row on trust.
 */
export function customTemplateRef(id: string): TemplateRef {
  return `${CUSTOM_TEMPLATE_PREFIX}${id}`;
}

export type ParsedTemplateRef = { kind: TemplateKind } | { customId: string };

/**
 * Narrow a value that came off the wire into something the renderer accepts.
 *
 * Returns null rather than throwing so every boundary — the Zod schema, the
 * preview route, the send job reading a column — can say "unknown template"
 * in its own way without a try/catch.
 */
export function parseTemplateRef(value: unknown): ParsedTemplateRef | null {
  if (typeof value !== "string") return null;
  if ((TEMPLATE_KINDS as readonly string[]).includes(value)) return { kind: value as TemplateKind };
  if (value.startsWith(CUSTOM_TEMPLATE_PREFIX)) {
    const id = value.slice(CUSTOM_TEMPLATE_PREFIX.length);
    if (UUID.test(id)) return { customId: id };
  }
  return null;
}

/**
 * The two campaign columns, from one reference.
 *
 * A custom template is a foreign key and a built-in kind is text, so the pair
 * is the storage shape; this is the only place that decides which column a
 * reference lands in, so the compose action and the campaign action cannot
 * disagree about it.
 */
export function templateColumns(ref: TemplateRef | null | undefined): {
  emailTemplate: TemplateKind | null;
  customTemplateId: string | null;
} {
  const parsed = ref ? parseTemplateRef(ref) : null;
  if (!parsed) return { emailTemplate: null, customTemplateId: null };
  if ("kind" in parsed) return { emailTemplate: parsed.kind, customTemplateId: null };
  return { emailTemplate: null, customTemplateId: parsed.customId };
}

/** What a picker needs to list an uploaded template. */
export type CustomTemplateSummary = {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
};

// ─── Validation ──────────────────────────────────────────────────────────────

export type CustomTemplateCheck =
  | { ok: true; placeholders: string[] }
  | { ok: false; errors: string[] };

const RAW_TOKEN = /\{\{\{\s*([\w.]+)\s*\}\}\}/g;
const TEXT_TOKEN = /(?<!\{)\{\{\s*([\w.]+)\s*\}\}(?!\})/g;
const OPEN_BLOCK = /\{\{#if\s+([\w.]+)\s*\}\}/g;
const CLOSE_BLOCK = /\{\{\/if\s*\}\}/g;
/** Anything else between double braces is a typo the renderer would print. */
const ANY_TOKEN = /\{\{[^}]*\}\}\}?/g;

/**
 * Whether uploaded HTML will render correctly, and if not, exactly why.
 *
 * Every rule here exists because the alternative is a failure nobody reports.
 * A placeholder the renderer does not know becomes an empty string in five
 * thousand inboxes; a second `{{{ body }}}` sends the message twice; a missing
 * unsubscribe link turns "unsubscribe" clicks into "report spam" clicks. The
 * upload is the last moment there is someone looking at a screen, so the
 * errors are specific — they name the token, not the rule.
 *
 * Pure, and in shared, so the form can run it before the round trip and the
 * Server Action can run the identical check before writing. Neither trusts
 * the other.
 */
export function validateCustomTemplate(html: string): CustomTemplateCheck {
  const errors: string[] = [];

  if (html.trim().length === 0) return { ok: false, errors: ["The template is empty."] };

  const bytes = new TextEncoder().encode(html).length;
  if (bytes > MAX_CUSTOM_TEMPLATE_BYTES) {
    errors.push(
      `The template is ${Math.round(bytes / 1024)}KB. The limit is ${MAX_CUSTOM_TEMPLATE_BYTES / 1024}KB — Gmail clips messages over about 100KB, and the unsubscribe link is in the part that gets clipped.`,
    );
  }

  if (/<script\b/i.test(html)) {
    errors.push("Remove the <script> tag. No mail client runs scripts; several reject the message outright.");
  }

  const rawTokens = [...html.matchAll(RAW_TOKEN)].map((match) => match[1]!);
  const bodyCount = rawTokens.filter((name) => name === BODY_SLOT).length;
  if (bodyCount === 0) {
    errors.push(
      "Add {{{ body }}} where the message should go. Without it the template would send with no content.",
    );
  } else if (bodyCount > 1) {
    errors.push(`{{{ body }}} appears ${bodyCount} times. It must appear exactly once.`);
  }

  for (const name of new Set(rawTokens)) {
    if (name !== BODY_SLOT) {
      errors.push(
        `Use two braces for {{ ${name} }}. Only body is inserted as raw HTML; everything else is text.`,
      );
    }
  }

  const textTokens = [...html.matchAll(TEXT_TOKEN)].map((match) => match[1]!);
  if (textTokens.includes(BODY_SLOT)) {
    errors.push("Write {{{ body }}} with three braces, so the message is inserted as HTML rather than escaped text.");
  }

  const opens = [...html.matchAll(OPEN_BLOCK)].map((match) => match[1]!);
  errors.push(...blockErrors(html));

  const placeholders = [...new Set([...rawTokens, ...textTokens, ...opens])];
  const unknown = placeholders.filter((name) => !isKnownTemplatePlaceholder(name));
  if (unknown.length > 0) {
    errors.push(
      `${unknown.map((name) => `{{ ${name} }}`).join(", ")} ${unknown.length === 1 ? "is" : "are"} not something the renderer fills in, so ${unknown.length === 1 ? "it" : "they"} would print as nothing. Known slots: ${[...SLOT_NAMES].join(", ")}; recipient fields: ${[...MERGE_TAGS].join(", ")}.`,
    );
  }

  // A brace pair the three patterns above did not recognise — `{{ first name }}`,
  // `{{#each}}`, `{{ else }}` — is the typo that would ship as literal text.
  const recognised = new Set(
    [...html.matchAll(RAW_TOKEN), ...html.matchAll(TEXT_TOKEN), ...html.matchAll(OPEN_BLOCK), ...html.matchAll(CLOSE_BLOCK)].map((match) => match[0]),
  );
  const stray = [...html.matchAll(ANY_TOKEN)]
    .map((match) => match[0])
    .filter((token) => !recognised.has(token));
  for (const token of new Set(stray)) {
    errors.push(`${token} is not a placeholder the renderer understands, and would be sent as written.`);
  }

  if (!placeholders.includes("unsubscribeUrl")) {
    errors.push(
      "Add an unsubscribe link using {{ unsubscribeUrl }}. Bulk mail without a visible one gets reported as spam instead, which costs far more than an unsubscribe. Wrap it in {{#if unsubscribeUrl}}…{{/if}} so one-to-one mail leaves it out.",
    );
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, placeholders };
}

/**
 * Whether the conditional blocks are ones the renderer can actually process.
 *
 * The renderer's block regex is lazy and non-nesting, and the body is spliced
 * in by splitting the document around `{{{ body }}}` — so a block that nests,
 * closes before it opens, or straddles the body can never match, and its
 * tokens ship as literal text in every recipient's inbox. Counting opens
 * against closes cannot see any of that; only a walk in document order can.
 */
function blockErrors(html: string): string[] {
  const errors: string[] = [];
  const events = /\{\{#if\s+([\w.]+)\s*\}\}|\{\{\/if\s*\}\}|\{\{\{\s*body\s*\}\}\}/g;
  let open: string | null = null;

  for (const match of html.matchAll(events)) {
    const token = match[0];
    if (token.startsWith("{{#if")) {
      const name = match[1]!;
      if (name === BODY_SLOT) {
        errors.push("{{#if body}} is meaningless — the body is always present. Remove the condition.");
      }
      if (open !== null) {
        errors.push(
          `{{#if ${name}}} sits inside {{#if ${open}}}. Blocks cannot nest; close the first before opening the second.`,
        );
        continue;
      }
      open = name;
    } else if (token.startsWith("{{/if")) {
      if (open === null) {
        errors.push("A {{/if}} appears before any {{#if …}} opens. Remove it, or add the opening tag.");
        continue;
      }
      open = null;
    } else if (open !== null) {
      errors.push(
        `{{{ body }}} sits inside {{#if ${open}}}. The message cannot be conditional; close the block before it.`,
      );
    }
  }

  if (open !== null) {
    errors.push(`{{#if ${open}}} is never closed. Add a matching {{/if}}.`);
  }
  return errors;
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

function slotLines(): string {
  return CUSTOM_TEMPLATE_SLOTS.map((slot) => {
    const token = slot.raw ? `{{{ ${slot.name} }}}` : `{{ ${slot.name} }}`;
    return `- ${token}${slot.required ? " (required)" : ""} — ${slot.description}`;
  }).join("\n");
}

function mergeFieldLines(): string {
  return MERGE_FIELDS.map((field) => `- {{ ${field.tag} }} — ${field.label}, e.g. “${field.example}”`).join(
    "\n",
  );
}

/**
 * The rules the renderer actually enforces, phrased for an author.
 *
 * Shared by both prompts so the two cannot describe different contracts, and
 * built from the slot list at module load so adding a slot updates the prompt
 * without anyone remembering to.
 */
const CONTRACT = `## Placeholders

Use exactly these. Anything else between double braces is rejected at upload.

${slotLines()}

Conditional blocks: {{#if name}} … {{/if}} keeps its contents only when that placeholder is non-empty. Blocks cannot nest, cannot contain {{{ body }}}, and there is no else; the upload is rejected otherwise.

Recipient fields (only meaningful for campaigns — on a one-to-one message they are empty, so wrap them in {{#if …}} or keep them out of the template):

${mergeFieldLines()}
- {{ attributes.key }} — any custom attribute on the contact

## Hard requirements

1. A complete HTML document: <!DOCTYPE html>, <html>, <head> with <meta charset="utf-8"> and a viewport meta, and <body>.
2. {{{ body }}} exactly once, with three braces. Everything else uses two braces.
3. A visible unsubscribe link using {{ unsubscribeUrl }}, wrapped in {{#if unsubscribeUrl}} … {{/if}}, with {{ postalAddress }} beneath it inside {{#if postalAddress}} … {{/if}}.
4. Inline styles only. No <style> block that the layout depends on, no external stylesheet, no CSS variables, no web fonts. Gmail strips <style> in several contexts and Outlook renders through Word.
5. Table-based layout with a 600px maximum width, centred, and role="presentation" on layout tables. Use px, never rem or em.
6. No <script>, no forms, no iframes, no video. Images must be absolute https:// URLs with width, height and alt attributes; never data: URIs.
7. Keep the whole file under 60KB so the finished message stays under Gmail's 102KB clipping limit once the body is inserted.
8. Every colour that should match the brand uses {{ primaryColor }}. Text placed on that colour must stay readable if the colour is pale — prefer dark text on a light band, or use the colour for accents rather than large fills.
9. Output only the HTML file. No explanation before or after it.`;

export const CUSTOM_TEMPLATE_PROMPTS = {
  /** A template from a brief. */
  generate: `You are writing an HTML email template for Sendstack, a bulk email tool. The template is the chrome around a message: the message itself is written later in a rich-text editor and inserted where {{{ body }}} appears. Design the frame, not the content.

Brief: [describe the look you want — e.g. “a minimal newsletter with a thin masthead, generous whitespace and a single accent colour”]

${CONTRACT}

Before answering, check your own output against the requirements list, especially that {{{ body }}} appears once and that the unsubscribe block is present.`,

  /** Existing HTML, brought into the contract. */
  adapt: `Below is an existing HTML email. Convert it into a reusable template for Sendstack, a bulk email tool, keeping its look as close to the original as email clients allow.

Replace the main content area with {{{ body }}} — the message is written later in a rich-text editor and inserted there. Replace the brand name, logo, colour and footer address with the placeholders below so they follow the workspace settings rather than being hard-coded. Replace any unsubscribe link with the required block.

${CONTRACT}

Here is the email to convert:

[paste the HTML here]`,
} as const;
