import { describe, expect, it } from "vitest";
import { inlineEmailStyles, isEmptyHtml, wrapEmailBody } from "./inline-styles";

describe("inlineEmailStyles", () => {
  it("inlines styles for every tag the editor can produce", () => {
    // A stylesheet cannot be relied on in email, so each of these has to carry
    // its own declaration or it renders as the client's default.
    for (const tag of ["p", "h2", "h3", "ul", "ol", "li", "blockquote", "a", "strong", "em", "s"]) {
      const out = inlineEmailStyles(`<${tag}>x</${tag}>`);
      expect(out, `${tag} was left unstyled`).toContain("style=");
    }
  });

  it("preserves existing attributes", () => {
    const out = inlineEmailStyles('<a href="https://example.com" target="_blank">x</a>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain("style=");
  });

  it("does not overwrite a style someone set deliberately", () => {
    const out = inlineEmailStyles('<p style="color:red">x</p>');
    expect(out).toBe('<p style="color:red">x</p>');
  });

  it("gives lists left padding, not margin", () => {
    // Outlook drops list margins and the bullets end up flush against the text.
    expect(inlineEmailStyles("<ul><li>x</li></ul>")).toContain("padding-left:22px");
  });

  it("leaves closing tags and unknown tags alone", () => {
    const out = inlineEmailStyles("<p>a</p><div>b</div>");
    expect(out).toContain("</p>");
    expect(out).toContain("<div>b</div>");
  });

  it("handles an empty string", () => {
    expect(inlineEmailStyles("")).toBe("");
  });
});

describe("wrapEmailBody", () => {
  it("pins a font family so Outlook does not fall back to Times", () => {
    expect(wrapEmailBody("<p>hi</p>")).toContain("font-family:");
  });

  it("caps the width so a reply does not stretch across a desktop client", () => {
    expect(wrapEmailBody("<p>hi</p>")).toContain("max-width:640px");
  });
});

describe("isEmptyHtml", () => {
  it.each(["", "<p></p>", "<p><br></p>", "<p>&nbsp;</p>", "   "])(
    "treats %s as empty",
    (html) => {
      // The editor emits <p></p> for an empty document, so a length check
      // would call a blank composer ready to send.
      expect(isEmptyHtml(html)).toBe(true);
    },
  );

  it.each(["<p>hi</p>", "<ul><li>x</li></ul>", "<h2>Title</h2>"])(
    "treats %s as having content",
    (html) => {
      expect(isEmptyHtml(html)).toBe(false);
    },
  );
});
