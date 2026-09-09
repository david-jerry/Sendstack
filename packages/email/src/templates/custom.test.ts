import { describe, expect, it } from "vitest";
import { renderCustomTemplate } from "./custom";
import { renderCampaignEmail, renderTemplatePreview, type Brand } from "./index";

const brand: Brand = {
  appName: "Acme Mail",
  appUrl: "https://mail.acme.test",
  primaryColor: "#1d4ed8",
  logoUrl: "https://mail.acme.test/api/branding/logo?v=abc123",
  postalAddress: "Acme Ltd, 1 High Street",
};

const template = `<!DOCTYPE html><html><body style="background:{{ primaryColor }}">
{{#if logoUrl}}<img src="{{ logoUrl }}" alt="{{ appName }}">{{/if}}
{{#if preheader}}<span class="pre">{{ preheader }}</span>{{/if}}
<h1>{{ subject }} for {{ firstName }}</h1>
<div class="content">{{{ body }}}</div>
{{#if unsubscribeUrl}}<a class="unsub" href="{{ unsubscribeUrl }}">Unsubscribe</a>{{/if}}
{{#if postalAddress}}<p class="addr">{{ postalAddress }}</p>{{/if}}
</body></html>`;

const props = {
  brand,
  subject: "February <update>",
  preheader: "Three things.",
  bodyHtml: "<p>Hi Ada,</p><p>Code sample: {{ notATag }}</p>",
  unsubscribeUrl: "https://mail.acme.test/unsubscribe?email=a%40b.co&token=x",
};

describe("renderCustomTemplate", () => {
  it("inserts the body as markup, exactly once", () => {
    const { html } = renderCustomTemplate(template, props);
    expect(html).toContain('<div class="content"><p>Hi Ada,</p>');
    expect(html.match(/Hi Ada/g)).toHaveLength(1);
    expect(html).not.toContain("{{{ body }}}");
  });

  it("does not run the body through the placeholder engine a second time", () => {
    // The body's own merge fields were resolved before it got here. A literal
    // `{{ … }}` left in it — a code sample, a tag the sender chose to keep —
    // must arrive as written, not be resolved against the template's context.
    const { html } = renderCustomTemplate(template, props);
    expect(html).toContain("Code sample: {{ notATag }}");
  });

  it("escapes every text slot", () => {
    // The subject is typed by an operator today and could come from an API
    // tomorrow; either way `<` in it must not become markup.
    const { html } = renderCustomTemplate(template, props);
    expect(html).toContain("February &lt;update&gt;");
    expect(html).not.toContain("February <update>");
  });

  it("fills the brand slots", () => {
    const { html } = renderCustomTemplate(template, props);
    expect(html).toContain("background:#1d4ed8");
    expect(html).toContain('alt="Acme Mail"');
    expect(html).toContain("logo?v=abc123");
    expect(html).toContain('class="addr">Acme Ltd, 1 High Street');
  });

  it("carries the unsubscribe link on bulk mail, escaped for an attribute", () => {
    const { html } = renderCustomTemplate(template, props);
    expect(html).toContain('href="https://mail.acme.test/unsubscribe?email=a%40b.co&amp;token=x"');
  });

  it("drops the unsubscribe block on one-to-one mail", () => {
    // A personal note must not carry an unsubscribe line; the built-in designs
    // do this with a JSX conditional, an uploaded one with `{{#if}}`.
    const { html } = renderCustomTemplate(template, { ...props, unsubscribeUrl: null });
    expect(html).not.toContain("Unsubscribe");
    expect(html).not.toContain("{{#if");
    expect(html).not.toContain("{{/if}}");
  });

  it("drops the logo and address blocks when the brand has neither", () => {
    const { html } = renderCustomTemplate(template, {
      ...props,
      brand: { ...brand, logoUrl: null, postalAddress: null },
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain('class="addr"');
  });

  it("personalises the chrome from the recipient context", () => {
    const { html } = renderCustomTemplate(template, props, { firstName: "Ada" });
    expect(html).toContain("for Ada</h1>");
  });

  it("renders a missing recipient field as nothing on one-to-one mail", () => {
    const { html } = renderCustomTemplate(template, props);
    expect(html).toContain("for </h1>");
  });

  it("emits a plain-text alternative", () => {
    const { text } = renderCustomTemplate(template, props);
    expect(text).toContain("Hi Ada,");
    expect(text).not.toContain("<div");
  });
});

describe("renderCampaignEmail with an uploaded template", () => {
  it("prefers the uploaded HTML over a built-in kind", async () => {
    const { html } = await renderCampaignEmail({
      ...props,
      template: "announcement",
      customTemplateHtml: template,
      context: { firstName: "Grace" },
    });
    expect(html).toContain('class="content"');
    expect(html).toContain("for Grace</h1>");
  });

  it("falls back to the built-in kind when the uploaded HTML is null", async () => {
    // What the send job passes when the template was deleted after sending
    // started: the message still goes out, in the chosen built-in design.
    const { html } = await renderCampaignEmail({
      ...props,
      template: "plain",
      customTemplateHtml: null,
    });
    expect(html).not.toContain('class="content"');
    expect(html).toContain("Hi Ada,");
  });
});

describe("renderTemplatePreview with an uploaded template", () => {
  it("renders the same sample copy the built-in previews use", async () => {
    const [custom, builtIn] = await Promise.all([
      renderTemplatePreview({ html: template }, brand),
      renderTemplatePreview("simple", brand),
    ]);
    expect(custom).toContain("Your February update is here");
    expect(builtIn).toContain("Your February update is here");
    expect(custom).toContain("for Ada</h1>");
  });
});
