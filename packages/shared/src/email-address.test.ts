import { describe, expect, it } from "vitest";
import {
  deriveThreadKey,
  isLikelyValidEmail,
  normalizeEmail,
  parseAddress,
  toSnippet,
} from "./email-address";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Bob@Example.COM ")).toBe("bob@example.com");
  });

  it("keeps +tagged addresses distinct", () => {
    // Merging these would let a suppressed address receive mail under an alias.
    expect(normalizeEmail("a+promo@e.com")).not.toBe(normalizeEmail("a@e.com"));
  });

  it("keeps dotted local parts distinct", () => {
    expect(normalizeEmail("a.b@e.com")).not.toBe(normalizeEmail("ab@e.com"));
  });
});

describe("isLikelyValidEmail", () => {
  it.each([
    ["ada.l@sub.example.co.uk", true],
    ["not-an-email", false],
    ["a@b..com", false],
    ["a@b", false],
    ["@example.com", false],
    ["a b@example.com", false],
    ["", false],
  ])("%s → %s", (input, expected) => {
    expect(isLikelyValidEmail(input)).toBe(expected);
  });
});

describe("parseAddress", () => {
  it("splits a display name from the address", () => {
    expect(parseAddress('"Ada Lovelace" <ada@e.com>')).toEqual({
      name: "Ada Lovelace",
      email: "ada@e.com",
    });
  });

  it("handles a bare address", () => {
    expect(parseAddress("ada@e.com")).toEqual({ name: null, email: "ada@e.com" });
  });
});

describe("deriveThreadKey", () => {
  it("prefers the head of References, which is stable across a whole thread", () => {
    expect(
      deriveThreadKey({ messageId: "<c>", inReplyTo: "<b>", references: ["<a>", "<b>"] }),
    ).toBe("<a>");
  });

  it("falls back to In-Reply-To when References is absent", () => {
    expect(deriveThreadKey({ messageId: "<c>", inReplyTo: "<b>", references: [] })).toBe("<b>");
  });

  it("falls back to the message's own id for a new thread", () => {
    expect(deriveThreadKey({ messageId: "<c>" })).toBe("<c>");
  });
});

describe("toSnippet", () => {
  it("collapses whitespace and strips tags", () => {
    expect(toSnippet("<p>hello   \n  world</p>")).toBe("hello world");
  });

  it("leaves no stray brackets from a conditional comment", () => {
    // Every Outlook-targeted email carries these, and stripping tags before
    // comments leaves the tail of one behind as visible punctuation.
    const html = "<!--[if mso]><table><tr><td><![endif]--><p>Hello</p><!--[if mso]></td></tr></table><![endif]-->";
    expect(toSnippet(html)).toBe("Hello");
  });

  it("drops style and script blocks whole", () => {
    expect(toSnippet("<style>body{color:red}</style><p>Hi</p>")).toBe("Hi");
    expect(toSnippet("<script>var a = 1 < 2;</script><p>Hi</p>")).toBe("Hi");
  });

  it("decodes the entities a reader would otherwise see raw", () => {
    expect(toSnippet("<p>Tom&nbsp;&amp; Jerry&#39;s &quot;show&quot;</p>")).toBe(
      `Tom & Jerry's "show"`,
    );
  });

  it("truncates with an ellipsis", () => {
    expect(toSnippet("x".repeat(300), 10)).toHaveLength(10);
  });

  it("returns null for an empty body", () => {
    expect(toSnippet(null)).toBeNull();
  });
});
