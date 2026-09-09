/**
 * Turns the editor's semantic HTML into HTML that survives a mail client.
 *
 * Email is the one place where a stylesheet cannot be relied on: Gmail strips
 * `<style>` in several contexts, Outlook renders through Word and ignores most
 * of it, and no client supports custom properties. Everything has to be an
 * inline `style` attribute.
 *
 * The defaults also matter more than they look. Mail clients apply their own
 * margins to `h2`, `ul` and `p`, and they disagree — so each tag states its
 * own spacing rather than inheriting whatever the client felt like.
 *
 * This is deliberately not a general HTML transformer. It handles the small,
 * known set of tags the composer can produce; pointing it at arbitrary markup
 * would be a sanitiser, which is a different and much harder job.
 */
const STYLES: Record<string, string> = {
  p: "margin:0 0 12px;font-size:15px;line-height:1.55;color:#18181b",
  h1: "margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:600;color:#18181b",
  h2: "margin:20px 0 10px;font-size:18px;line-height:1.35;font-weight:600;color:#18181b",
  h3: "margin:16px 0 8px;font-size:15px;line-height:1.4;font-weight:600;color:#18181b",
  // Left padding rather than margin: Outlook drops list margins entirely and
  // the bullets end up flush against the text.
  ul: "margin:0 0 12px;padding-left:22px;font-size:15px;line-height:1.55;color:#18181b",
  ol: "margin:0 0 12px;padding-left:22px;font-size:15px;line-height:1.55;color:#18181b",
  li: "margin:0 0 4px",
  blockquote:
    "margin:0 0 12px;padding:2px 0 2px 12px;border-left:3px solid #e4e4e7;color:#52525b;font-size:15px;line-height:1.55",
  a: "color:#1d4ed8;text-decoration:underline",
  strong: "font-weight:600",
  em: "font-style:italic",
  s: "text-decoration:line-through",
};

const TAGS = Object.keys(STYLES).join("|");
const OPENING_TAG = new RegExp(`<(${TAGS})(\\s[^>]*)?>`, "gi");

export function inlineEmailStyles(html: string): string {
  if (!html) return html;

  return html.replace(OPENING_TAG, (_match, tag: string, attributes: string | undefined) => {
    const name = tag.toLowerCase();
    const declaration = STYLES[name];
    if (!declaration) return _match;

    const rest = attributes ?? "";
    // An existing style attribute wins — it was set deliberately, and the
    // defaults here are only there to fill a gap.
    if (/\sstyle\s*=/i.test(rest)) return `<${tag}${rest}>`;

    return `<${tag}${rest} style="${declaration}">`;
  });
}

/**
 * Wrap composed HTML in the outer shell a message needs.
 *
 * A bare fragment inherits whatever the client decides, which in practice
 * means Times New Roman in Outlook. The wrapper pins the family and gives the
 * body a maximum width so a reply does not stretch to 1,600px on a desktop
 * client.
 */
export function wrapEmailBody(html: string): string {
  return (
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;` +
    `font-size:15px;line-height:1.55;color:#18181b;max-width:640px">` +
    `${inlineEmailStyles(html)}` +
    `</div>`
  );
}

/**
 * Whether composed HTML actually contains anything.
 *
 * The editor emits `<p></p>` for an empty document, so a naive length check
 * would treat a blank composer as ready to send.
 */
export function isEmptyHtml(html: string): boolean {
  return (
    html
      .replace(/<br\s*\/?>/gi, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/<[^>]+>/g, "")
      .trim().length === 0
  );
}
