/**
 * Word capitalisation for name fields.
 *
 * The naive `replace(/\b\w/g, c => c.toUpperCase())` plus a lowercase of the
 * rest is actively destructive: it turns `IBM` into `Ibm`, `eBay` into `EBay`
 * and `iPhone` into `IPhone`. People notice when software mangles their own
 * name or their company's.
 *
 * So this follows two rules:
 *
 *  1. **Never lowercase anything.** Existing capitals are always someone's
 *     intent, and we have no way to tell a typo from `JSON`.
 *  2. **Only touch a word that is entirely lowercase.** A word that already
 *     contains a capital has been deliberately cased — `eBay`, `McDonald`,
 *     `IBM`, `van` in `van der Berg` if the user typed it that way — and is
 *     left exactly as written.
 *
 * Apostrophes and hyphens count as word boundaries, because `o'brien` and
 * `jean-luc` are the common cases this is for and both read wrong without it.
 *
 * The remaining trade-off, stated plainly: a deliberately lowercase name like
 * `basecamp` becomes `Basecamp`. For the fields this is applied to — a
 * workspace name, a person's name, a sender name — that is the right default,
 * but it is a default, not a truth.
 */

/** Space, hyphen, apostrophe (straight or curly) start a new word. */
const WORD_BOUNDARY = /([\s\-–—'’]+)/;

export function toTitleCase(input: string): string {
  if (!input) return input;

  // split() with a capturing group keeps the separators, so the exact spacing
  // the user typed — including a trailing space they are mid-word on — survives.
  return input
    .split(WORD_BOUNDARY)
    .map((part) => capitalizeWord(part))
    .join("");
}

function capitalizeWord(word: string): string {
  if (word.length === 0) return word;
  // Already cased by hand: leave it completely alone.
  if (/[A-Z]/.test(word)) return word;

  const first = word[0]!;
  const upper = first.toUpperCase();
  // Digits and punctuation have no uppercase form; `1st` must stay `1st`.
  if (upper === first) return word;

  return upper + word.slice(1);
}

/**
 * Capitalise only the part of the value the user just typed.
 *
 * This is what stops the transform fighting an edit. Typing forward grows the
 * string, so a new word-initial letter gets capitalised. Deleting a capital,
 * or replacing a selection, does not grow it — and the value is returned
 * untouched, so someone who genuinely wants `basecamp` can backspace over the
 * `B` and it stays lowercase.
 */
export function capitalizeTypedInput(previous: string, next: string): string {
  // Not an insertion — a deletion, a replacement, or a paste that shortened
  // the value. Leave the user's edit exactly as they made it.
  if (next.length <= previous.length) return next;
  return toTitleCase(next);
}

/** Collapse runs of whitespace and trim. For names arriving from a form. */
export function normalizeName(input: string): string {
  return toTitleCase(input.replace(/\s+/g, " ").trim());
}

/**
 * The `Re:`/`Fwd:` prefixes a subject accumulates, as one pattern.
 *
 * Exported as a **source string**, not a `RegExp`, because it is needed on
 * both sides of a comparison in two languages: `baseSubject` below builds a
 * JavaScript regex from it, and the sent-mail reconciler interpolates it into
 * a Postgres `regexp_replace` to match stored subjects. Those two were written
 * out separately and disagreed — the TypeScript copy trimmed the result and
 * the SQL copy did not, so a subject with trailing whitespace compared unequal
 * and a recovered reply silently failed to rejoin its thread, which is the one
 * thing that query exists to do.
 *
 * Postgres and JavaScript agree on this syntax, so one string serves both. A
 * caller on the SQL side must also `btrim`, matching the `.trim()` here.
 */
export const SUBJECT_PREFIX_PATTERN = "^((re|fwd?)\\s*:\\s*)+";

/**
 * A subject with every `Re:`/`Fwd:` prefix stripped, or null if nothing is
 * left. Used to match a reply back to the conversation it belongs to.
 */
export function baseSubject(subject: string | null | undefined): string | null {
  if (!subject) return null;
  const base = subject.replace(new RegExp(SUBJECT_PREFIX_PATTERN, "i"), "").trim();
  return base.length > 0 ? base : null;
}

/**
 * A URL-safe slug, with a fallback for input that reduces to nothing.
 *
 * `createList` and `createContactGroup` each had this chain inline, differing
 * only in the fallback word. The 54-character cap is deliberate and was
 * unexplained in both copies: the callers append a `-N` disambiguating suffix
 * when a slug collides, so the cap leaves room for it inside a sane total
 * length rather than being a database limit — both columns are `text`.
 */
export function slugify(input: string, fallback: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 54);
  return slug || fallback;
}

/**
 * An absolute URL from the configured app URL, with exactly one slash.
 *
 * Six call sites wrote `appUrl.replace(/\/$/, "")` by hand — the auth
 * origin, two Settings pages, the attachment link, the unsubscribe base and
 * the branding asset URL. Each of them is building a URL that goes somewhere
 * permanent: a session callback, a link inside an email that must keep
 * resolving for years.
 *
 * **`\/+$`, not `\/$`.** Stripping one slash leaves the second, so an
 * operator who pastes `https://mail.example.com//` gets a double slash in
 * every unsubscribe link. That exact bug is why `brandingFormSchema` already
 * strips a run rather than a single character; five of the six copies here
 * still stripped one. Two rules for one thing, and the weaker one had the
 * majority.
 *
 * The path is joined rather than concatenated because the callers disagree
 * about whether their path is already rooted — `branding.ts` passes
 * `ref.href`, which starts with a slash, and `attachments.ts` builds its own.
 */
export function absoluteUrl(appUrl: string, path = ""): string {
  const base = appUrl.replace(/\/+$/, "");
  if (!path) return base;
  return `${base}/${path.replace(/^\/+/, "")}`;
}
