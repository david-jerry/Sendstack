import { describe, expect, it } from "vitest";
import { renderAuthEmail, renderCampaignEmail, type Brand } from "./index";

const brand: Brand = {
  appName: "Acme Mail",
  appUrl: "https://mail.acme.test",
  primaryColor: "#1d4ed8",
  logoUrl: "https://mail.acme.test/api/branding/logo?v=abc123",
  postalAddress: "Acme Ltd, 1 High Street, London EC1A 1AA",
};

const base = {
  brand,
  subject: "February update",
  preheader: "Three things we shipped.",
  bodyHtml: "<p>Hi Ada,</p><p>Here is what changed.</p>",
  ctaLabel: "Read more",
  ctaUrl: "https://mail.acme.test/post",
  unsubscribeUrl: "https://mail.acme.test/unsubscribe?email=a%40b.co&token=x",
};

const KINDS = ["simple", "announcement", "newsletter", "plain"] as const;

describe.each(KINDS)("%s template", (template) => {
  it("renders a complete document containing the body", async () => {
    const { html } = await renderCampaignEmail({ ...base, template });
    expect(html).toContain("<html");
    expect(html).toContain("Here is what changed");
  });

  it("carries the unsubscribe link", async () => {
    // Not decoration: a visible unsubscribe is what keeps recipients off the
    // "report spam" button, which costs a sender far more.
    const { html } = await renderCampaignEmail({ ...base, template });
    expect(html).toContain("/unsubscribe?email=");
  });

  it("emits a plain-text alternative", async () => {
    // A message with no text part scores as more spam-like with every filter.
    const { text } = await renderCampaignEmail({ ...base, template });
    expect(text.length).toBeGreaterThan(20);
    expect(text).not.toContain("<table");
  });

  it("sets a preheader rather than letting clients scrape the body", async () => {
    const { html } = await renderCampaignEmail({ ...base, template });
    expect(html).toContain("Three things we shipped");
  });

  it("uses inline styles, which is all mail clients agree on", async () => {
    const { html } = await renderCampaignEmail({ ...base, template });
    expect(html).toContain("style=");
  });

  it("prints the sender's postal address", async () => {
    // CAN-SPAM requires a physical address on commercial mail, and filters
    // read its absence as a sign the sender is not a findable organisation.
    // Every template has to carry it, not just the branded ones.
    const { html } = await renderCampaignEmail({ ...base, template });
    expect(html).toContain("1 High Street");
  });

  it("keeps the address out of the way when none is set", async () => {
    // A blank line where the address would be looks like a rendering bug.
    const { html } = await renderCampaignEmail({
      ...base,
      template,
      brand: { ...brand, postalAddress: null },
    });
    expect(html).not.toContain("High Street");
    expect(html).toContain("/unsubscribe?email=");
  });
});

describe("branded templates", () => {
  it.each(["simple", "announcement", "newsletter"] as const)(
    "%s embeds the absolute, cache-busted logo URL",
    async (template) => {
      // Absolute because a mail client has no page to resolve a relative path
      // against; cache-busted because providers cache images hard.
      const { html } = await renderCampaignEmail({ ...base, template });
      expect(html).toContain("https://mail.acme.test/api/branding/logo?v=abc123");
    },
  );

  it.each(["simple", "announcement", "newsletter"] as const)(
    "%s applies the brand colour",
    async (template) => {
      const { html } = await renderCampaignEmail({ ...base, template });
      expect(html.toLowerCase()).toContain("#1d4ed8");
    },
  );

  it("falls back to the app name when no logo is uploaded", async () => {
    const { html } = await renderCampaignEmail({
      ...base,
      template: "simple",
      brand: { ...brand, logoUrl: null },
    });
    expect(html).toContain("Acme Mail");
  });
});

describe("plain template", () => {
  it("omits the logo entirely", async () => {
    // Deliberately chrome-free — it should read as a message from a person.
    const { html } = await renderCampaignEmail({ ...base, template: "plain" });
    expect(html).not.toContain("branding/logo");
  });
});

describe("renderAuthEmail", () => {
  it("shows the link as a button and as raw text", async () => {
    // Some clients strip buttons, and cautious people want to see the target.
    const url = "https://mail.acme.test/magic?token=xyz";
    const html = await renderAuthEmail({
      brand,
      heading: "Sign in to Acme Mail",
      body: "Click below.",
      ctaLabel: "Sign in",
      ctaUrl: url,
    });
    expect(html.split(url).length - 1).toBeGreaterThanOrEqual(2);
  });
});
