import { describe, expect, it } from "vitest";
import { escapeHtml, htmlToText, renderTemplate } from "./render";

describe("renderTemplate", () => {
  it("escapes merge values by default", () => {
    // Contact data comes from CSV uploads and public forms.
    const output = renderTemplate("<p>Hi {{ firstName }}</p>", {
      firstName: "<script>alert(1)</script>",
    });
    expect(output).not.toContain("<script>");
    expect(output).toContain("&lt;script&gt;");
  });

  it("escapes the ordinary case too", () => {
    expect(renderTemplate("{{ n }}", { n: "Ben & Jerry's" })).toBe("Ben &amp; Jerry&#39;s");
  });

  it("lets triple braces opt out", () => {
    expect(renderTemplate("{{{ n }}}", { n: "<b>x</b>" })).toBe("<b>x</b>");
  });

  it("resolves dotted paths into attributes", () => {
    expect(renderTemplate("{{ attributes.plan }}", { attributes: { plan: "pro" } })).toBe("pro");
  });

  it("renders a missing field as empty rather than the literal token", () => {
    expect(renderTemplate("[{{ nope }}]", {})).toBe("[]");
  });

  it("does not let a triple-brace pass be eaten by the double-brace pass", () => {
    expect(renderTemplate("{{{ a }}} {{ b }}", { a: "<i>", b: "<i>" })).toBe("<i> &lt;i&gt;");
  });

  it("keeps a conditional block when the value is non-empty", () => {
    expect(renderTemplate("a{{#if x}}[{{ x }}]{{/if}}b", { x: "y" })).toBe("a[y]b");
  });

  it("drops a conditional block, tokens included, when the value is empty or missing", () => {
    // The tokens inside must never render: an uploaded template hides its
    // unsubscribe footer this way on one-to-one mail.
    expect(renderTemplate("a{{#if x}}[{{ x }}]{{/if}}b", { x: "" })).toBe("ab");
    expect(renderTemplate("a{{#if x}}[{{ x }}]{{/if}}b", {})).toBe("ab");
    expect(renderTemplate("a{{#if x}}[{{ x }}]{{/if}}b", { x: null })).toBe("ab");
  });

  it("resolves several blocks independently", () => {
    expect(
      renderTemplate("{{#if a}}A{{/if}}{{#if b}}B{{/if}}{{#if c}}C{{/if}}", { a: "1", c: "3" }),
    ).toBe("AC");
  });

  it("leaves a body with no blocks exactly as before", () => {
    // Campaign bodies go through this too; adding blocks must not change them.
    expect(renderTemplate("<p>Hi {{ firstName }}</p>", { firstName: "Ada" })).toBe("<p>Hi Ada</p>");
  });
});

describe("htmlToText", () => {
  it("separates blocks with a blank line", () => {
    expect(htmlToText("<p>a</p><p>b</p>")).toBe("a\n\nb");
  });

  it("drops script and style contents entirely", () => {
    expect(htmlToText("<style>.x{}</style><script>bad()</script><p>ok</p>")).toBe("ok");
  });

  it("decodes the common entities", () => {
    expect(htmlToText("<p>a &amp; b</p>")).toBe("a & b");
  });
});

describe("escapeHtml", () => {
  it("covers all five characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
