import { describe, expect, it } from "vitest";
import {
  CUSTOM_TEMPLATE_PROMPTS,
  CUSTOM_TEMPLATE_SLOTS,
  MAX_CUSTOM_TEMPLATE_BYTES,
  customTemplateRef,
  parseTemplateRef,
  templateColumns,
  validateCustomTemplate,
} from "./custom-templates";
import { MERGE_FIELDS } from "./merge-fields";

const ID = "4fd94928-ee57-41d3-ad59-f25d8b894766";

/** The smallest template the validator accepts. Tests below break one rule each. */
const VALID = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>
<h1>{{ subject }}</h1>
{{{ body }}}
{{#if unsubscribeUrl}}<a href="{{ unsubscribeUrl }}">Unsubscribe</a>{{/if}}
</body></html>`;

describe("validateCustomTemplate", () => {
  it("accepts a template that meets the contract", () => {
    const result = validateCustomTemplate(VALID);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.placeholders).toEqual(["body", "subject", "unsubscribeUrl"]);
  });

  it("requires the body slot", () => {
    // Without it the template would send with no message in it.
    const result = validateCustomTemplate(VALID.replace("{{{ body }}}", ""));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("{{{ body }}}");
  });

  it("refuses a second body slot", () => {
    // Two slots is the message sent twice in one email.
    const result = validateCustomTemplate(VALID.replace("{{{ body }}}", "{{{ body }}}{{{ body }}}"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("appears 2 times");
  });

  it("explains a body written with two braces", () => {
    const result = validateCustomTemplate(VALID.replace("{{{ body }}}", "{{ body }}"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("three braces");
  });

  it("refuses raw insertion of anything but the body", () => {
    // A subject inserted raw is an HTML injection point for whoever types it.
    const result = validateCustomTemplate(VALID.replace("{{ subject }}", "{{{ subject }}}"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("Use two braces for {{ subject }}");
  });

  it("requires a visible unsubscribe link", () => {
    // Bulk mail without one gets reported as spam instead.
    const result = validateCustomTemplate(
      VALID.replace('{{#if unsubscribeUrl}}<a href="{{ unsubscribeUrl }}">Unsubscribe</a>{{/if}}', ""),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("unsubscribeUrl");
  });

  it("names a placeholder the renderer would print as nothing", () => {
    const result = validateCustomTemplate(VALID.replace("{{ subject }}", "{{ headline }}"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("{{ headline }}");
  });

  it("allows recipient merge fields and attributes", () => {
    const result = validateCustomTemplate(
      VALID.replace("{{ subject }}", "{{ firstName }} at {{ company }} — {{ attributes.plan }}"),
    );
    expect(result.ok).toBe(true);
  });

  it("catches an unbalanced conditional", () => {
    const result = validateCustomTemplate(VALID.replace("{{/if}}", ""));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("never closed");
  });

  // The renderer's block regex is lazy and non-nesting and the body is spliced
  // in by splitting the document, so each of these would ship literal
  // `{{#if …}}` text to every recipient. Counting opens against closes passes
  // all four; only an in-order walk refuses them.
  it("refuses a nested conditional", () => {
    const result = validateCustomTemplate(
      VALID.replace("<h1>", "{{#if firstName}}{{#if company}}X{{/if}}{{/if}}<h1>"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("cannot nest");
  });

  it("refuses a close before any open, even when the count balances", () => {
    const result = validateCustomTemplate(VALID.replace("<h1>", "{{/if}}<h1>{{#if firstName}}"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("before any {{#if");
  });

  it("refuses a block that wraps the body", () => {
    const result = validateCustomTemplate(
      VALID.replace("{{{ body }}}", "{{#if firstName}}{{{ body }}}{{/if}}"),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("cannot be conditional");
  });

  it("refuses a condition on the body itself", () => {
    const result = validateCustomTemplate(VALID.replace("<h1>", "{{#if body}}x{{/if}}<h1>"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("{{#if body}}");
  });

  it("rejects a self-closing script tag too", () => {
    const result = validateCustomTemplate(VALID.replace("<h1>", "<script/><h1>"));
    expect(result.ok).toBe(false);
  });

  it("catches a brace pair that is not a placeholder at all", () => {
    // `{{ first name }}` with a space is the typo that ships as literal text.
    const result = validateCustomTemplate(VALID.replace("{{ subject }}", "{{ first name }}"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("{{ first name }}");
  });

  it("rejects a script tag", () => {
    const result = validateCustomTemplate(VALID.replace("<h1>", "<script>x()</script><h1>"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("<script>");
  });

  it("rejects an upload over the size limit", () => {
    const padded = VALID.replace("<h1>", `<!--${"x".repeat(MAX_CUSTOM_TEMPLATE_BYTES)}--><h1>`);
    const result = validateCustomTemplate(padded);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("limit is");
  });

  it("reports every problem at once, not the first", () => {
    const broken = "<html>{{ headline }}</html>";
    const result = validateCustomTemplate(broken);
    expect(result.ok).toBe(false);
    // No body, unknown placeholder, no unsubscribe — three fixes, one round trip.
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe("template references", () => {
  it("parses the built-in kinds", () => {
    expect(parseTemplateRef("plain")).toEqual({ kind: "plain" });
  });

  it("parses an uploaded template by id", () => {
    expect(parseTemplateRef(customTemplateRef(ID))).toEqual({ customId: ID });
  });

  it("rejects anything else", () => {
    // These arrive off a query string and an offline queue; none may select a row.
    expect(parseTemplateRef("custom:not-a-uuid")).toBeNull();
    expect(parseTemplateRef("fancy")).toBeNull();
    expect(parseTemplateRef(undefined)).toBeNull();
    expect(parseTemplateRef(42)).toBeNull();
  });

  it("maps a reference onto the two campaign columns", () => {
    // One place decides which column a choice lands in.
    expect(templateColumns("newsletter")).toEqual({ emailTemplate: "newsletter", customTemplateId: null });
    expect(templateColumns(customTemplateRef(ID))).toEqual({ emailTemplate: null, customTemplateId: ID });
    expect(templateColumns(null)).toEqual({ emailTemplate: null, customTemplateId: null });
  });
});

describe("prompts", () => {
  it.each(Object.entries(CUSTOM_TEMPLATE_PROMPTS))("%s names every slot and every merge field", (_name, prompt) => {
    // The prompt is generated from the slot list so it cannot promise a
    // placeholder the renderer does not fill — this pins that.
    for (const slot of CUSTOM_TEMPLATE_SLOTS) {
      expect(prompt).toContain(slot.raw ? `{{{ ${slot.name} }}}` : `{{ ${slot.name} }}`);
    }
    for (const field of MERGE_FIELDS) expect(prompt).toContain(`{{ ${field.tag} }}`);
    expect(prompt).toContain("{{#if unsubscribeUrl}}");
  });

  it("produces output the validator accepts when followed literally", () => {
    // The prompt's own hard-requirements list, turned into markup.
    const followed = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0"><table role="presentation" width="100%"><tr><td>
{{#if logoUrl}}<img src="{{ logoUrl }}" width="120" height="28" alt="{{ appName }}">{{/if}}
{{#if preheader}}<span style="display:none">{{ preheader }}</span>{{/if}}
<h1 style="color:{{ primaryColor }}">{{ subject }}</h1>
{{{ body }}}
{{#if unsubscribeUrl}}<p><a href="{{ unsubscribeUrl }}">Unsubscribe</a></p>{{/if}}
{{#if postalAddress}}<p>{{ postalAddress }}</p>{{/if}}
<p><a href="{{ appUrl }}">{{ appName }}</a></p>
</td></tr></table></body></html>`;
    expect(validateCustomTemplate(followed).ok).toBe(true);
  });
});
