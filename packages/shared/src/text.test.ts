import { describe, expect, it } from "vitest";
import {
  absoluteUrl,
  capitalizeTypedInput,
  normalizeName,
  toTitleCase,
} from "./text";

describe("toTitleCase", () => {
  it.each([
    ["acme mail", "Acme Mail"],
    ["jeremiah david", "Jeremiah David"],
    ["the daily dispatch", "The Daily Dispatch"],
    ["a", "A"],
  ])("capitalises %s", (input, expected) => {
    expect(toTitleCase(input)).toBe(expected);
  });

  it.each([
    ["IBM", "IBM"],
    ["eBay", "eBay"],
    ["iPhone", "iPhone"],
    ["McDonald", "McDonald"],
    ["JSON Weekly", "JSON Weekly"],
    ["nginx GmbH", "Nginx GmbH"],
  ])("leaves deliberately-cased %s alone", (input, expected) => {
    // A word containing a capital was cased by a person. We cannot tell a typo
    // from an acronym, so we never overrule them.
    expect(toTitleCase(input)).toBe(expected);
  });

  it("never lowercases anything", () => {
    expect(toTitleCase("ACME MAIL")).toBe("ACME MAIL");
  });

  it.each([
    ["o'brien", "O'Brien"],
    ["jean-luc picard", "Jean-Luc Picard"],
    ["d'angelo", "D'Angelo"],
    ["mary-jane o'connor", "Mary-Jane O'Connor"],
  ])("treats apostrophes and hyphens as word boundaries: %s", (input, expected) => {
    expect(toTitleCase(input)).toBe(expected);
  });

  it("preserves the exact spacing the user typed", () => {
    // Critical while typing: collapsing a trailing space would move the caret.
    expect(toTitleCase("acme  mail ")).toBe("Acme  Mail ");
    expect(toTitleCase("acme ")).toBe("Acme ");
  });

  it("leaves words with no uppercase form alone", () => {
    expect(toTitleCase("1st edition")).toBe("1st Edition");
    expect(toTitleCase("100 things")).toBe("100 Things");
  });

  it("handles empty and whitespace-only input", () => {
    expect(toTitleCase("")).toBe("");
    expect(toTitleCase("   ")).toBe("   ");
  });
});

describe("capitalizeTypedInput", () => {
  it("capitalises as the value grows", () => {
    expect(capitalizeTypedInput("", "a")).toBe("A");
    expect(capitalizeTypedInput("Acme ", "Acme m")).toBe("Acme M");
  });

  it("does not fight a deletion", () => {
    // Backspacing over a capital we added must leave it gone.
    expect(capitalizeTypedInput("Acme", "Acm")).toBe("Acm");
    expect(capitalizeTypedInput("Acme", "cme")).toBe("cme");
  });

  it("does not fight a same-length replacement", () => {
    // Selecting the "A" and typing "a" is a deliberate override.
    expect(capitalizeTypedInput("Acme", "acme")).toBe("acme");
  });

  it("capitalises a pasted value that grows the field", () => {
    expect(capitalizeTypedInput("", "acme mail")).toBe("Acme Mail");
  });

  it("leaves a paste that shortens the field alone", () => {
    expect(capitalizeTypedInput("acme mail weekly", "acme")).toBe("acme");
  });
});

describe("normalizeName", () => {
  it("collapses whitespace and trims before capitalising", () => {
    expect(normalizeName("  acme   mail  ")).toBe("Acme Mail");
  });

  it("still protects intentional casing", () => {
    expect(normalizeName("  eBay   store ")).toBe("eBay Store");
  });
});

/**
 * The URL rule six call sites used to carry a weaker copy of.
 */
describe("absoluteUrl", () => {
  it("strips a run of trailing slashes, not just one", () => {
    // Five of the six copies used `\/$`, so this input kept a slash and every
    // link built from it carried a double slash.
    expect(absoluteUrl("https://mail.example.com//")).toBe("https://mail.example.com");
    expect(absoluteUrl("https://mail.example.com///")).toBe("https://mail.example.com");
  });

  it("leaves a clean base alone", () => {
    expect(absoluteUrl("https://mail.example.com")).toBe("https://mail.example.com");
    expect(absoluteUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("joins a path with exactly one slash, however the caller wrote it", () => {
    // `branding.ts` passes an already-rooted `ref.href`; `attachments.ts`
    // builds its own path. Both must produce one slash.
    expect(absoluteUrl("https://a.test", "/api/x")).toBe("https://a.test/api/x");
    expect(absoluteUrl("https://a.test", "api/x")).toBe("https://a.test/api/x");
    expect(absoluteUrl("https://a.test/", "/api/x")).toBe("https://a.test/api/x");
    expect(absoluteUrl("https://a.test//", "//api/x")).toBe("https://a.test/api/x");
  });

  it("returns the bare base when no path is given", () => {
    expect(absoluteUrl("https://a.test/")).toBe("https://a.test");
  });
});
