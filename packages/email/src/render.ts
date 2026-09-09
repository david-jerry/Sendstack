/**
 * Merge-field rendering: `Hi {{ firstName }}` against a contact's data.
 *
 * Values are HTML-escaped by default. Contact data arrives from CSV uploads
 * and public sign-up forms, so a first name of `<script>…` or, more likely, an
 * innocent `Ben & Jerry's` must not be able to break the markup of an email
 * going to ten thousand people. `{{{ raw }}}` opts out for the rare case where
 * a field genuinely holds markup.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

export type MergeContext = Record<string, unknown>;

function lookup(context: MergeContext, path: string): string {
  const value = path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined,
      context,
    );

  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

/**
 * `{{#if path}}…{{/if}}` — kept when the value is non-empty, dropped otherwise.
 *
 * Non-nesting and without an `else`, on purpose. It exists for one job: an
 * uploaded template has to hide its unsubscribe footer on one-to-one mail and
 * its logo when none is uploaded, and the built-in designs do that with a
 * JSX conditional. A full block language would be a second template engine
 * to keep correct; this is the smallest thing that lets HTML do the same.
 *
 * Resolved before the value passes so the tokens inside a dropped block never
 * render — and so a block's own delimiters cannot be eaten by the `{{ }}`
 * pass, whose `[\w.]+` does not match `#if x` or `/if` anyway.
 */
const BLOCK = /\{\{#if\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/if\s*\}\}/g;

/** Sections first, then triple-brace, so the double-brace pass cannot eat either's delimiters. */
export function renderTemplate(template: string, context: MergeContext): string {
  return template
    .replace(BLOCK, (_match, path: string, inner: string) =>
      lookup(context, path) !== "" ? inner : "",
    )
    .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_match, path: string) => lookup(context, path))
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) =>
      escapeHtml(lookup(context, path)),
    );
}

/** Crude but dependable HTML-to-text for the multipart alternative. */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    // Blank line after a block, single newline after a list or table row —
    // otherwise the plain-text alternative arrives as one undifferentiated
    // wall, which is exactly the part spam filters read most closely.
    .replace(/<\/(p|div|h[1-6]|blockquote|section|article)>/gi, "\n\n")
    .replace(/<\/(li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
