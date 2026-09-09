import { BODY_SLOT } from "@sendstack/shared";
import { htmlToText, renderTemplate, type MergeContext } from "../render";
import type { TemplateProps } from "./designs";

/**
 * Wrap a message in an uploaded template.
 *
 * The body is spliced in with a string split rather than through the
 * placeholder engine, and this ordering is the whole point of the function:
 * the body has *already* had its merge fields substituted, and a body that
 * happens to contain a literal `{{ something }}` — a code sample, an
 * unresolvable tag the sender chose to keep — must arrive as written rather
 * than being resolved a second time against the template's context. Every
 * other slot is text, is HTML-escaped by `{{ }}`, and is filled by the same
 * `renderTemplate` the campaign body went through, so there is one engine and
 * one escaping rule.
 *
 * Recipient fields are passed in as `context` so a template can say
 * `{{ firstName }}` in a heading; they are simply absent on one-to-one mail,
 * where the `{{#if}}` blocks the upload validator insists on take over.
 */
export function renderCustomTemplate(
  templateHtml: string,
  props: TemplateProps,
  context: MergeContext = {},
): { html: string; text: string } {
  const slots: MergeContext = {
    ...context,
    subject: props.subject,
    preheader: props.preheader ?? "",
    unsubscribeUrl: props.unsubscribeUrl ?? "",
    appName: props.brand.appName,
    appUrl: props.brand.appUrl,
    logoUrl: props.brand.logoUrl ?? "",
    primaryColor: props.brand.primaryColor,
    postalAddress: props.brand.postalAddress ?? "",
  };

  // Exactly one occurrence is enforced at upload; splitting on the first is
  // still correct if that guarantee is ever loosened, because the remainder
  // is rendered as chrome rather than dropped.
  const token = new RegExp(`\\{\\{\\{\\s*${BODY_SLOT}\\s*\\}\\}\\}`);
  const match = token.exec(templateHtml);
  const head = match ? templateHtml.slice(0, match.index) : templateHtml;
  const tail = match ? templateHtml.slice(match.index + match[0].length) : "";

  const html = renderTemplate(head, slots) + props.bodyHtml + renderTemplate(tail, slots);
  return { html, text: htmlToText(html) };
}
