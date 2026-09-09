import { describe, expect, it } from "vitest";
import { notificationPreview } from "./inbound-store";

/**
 * The one line somebody reads on a lock screen.
 *
 * Tested on its own because it is the difference between a notification worth
 * unlocking a phone for and one that says "New message" — and because it is
 * pure, where everything around it in `inbound-store.ts` needs a database.
 */
describe("notificationPreview", () => {
  it("shows the subject and the opening of the body", () => {
    expect(notificationPreview("Q3 numbers", "Here are the figures you asked for")).toBe(
      "Q3 numbers — Here are the figures you asked for",
    );
  });

  it("falls back to whichever part exists", () => {
    // A subject alone often says nothing ("Re: following up") and a snippet
    // alone loses the thread, so both are shown where both exist — but one is
    // much better than neither.
    expect(notificationPreview("Q3 numbers", null)).toBe("Q3 numbers");
    expect(notificationPreview(null, "Here are the figures")).toBe("Here are the figures");
  });

  it("never returns an empty body", () => {
    // A push with no body is allowed and reads as a bug.
    expect(notificationPreview(null, null)).toBe("New message");
    expect(notificationPreview("", "   ")).toBe("New message");
    expect(notificationPreview(undefined, undefined)).toBe("New message");
  });

  it("collapses the whitespace a quoted reply is full of", () => {
    // Snippets come from HTML mail, where newlines and runs of spaces are
    // formatting rather than content — and a notification is one line.
    expect(notificationPreview("Re: hello", "line one\n\n   line two")).toBe(
      "Re: hello — line one line two",
    );
  });

  it("truncates on a word boundary rather than mid-syllable", () => {
    const snippet = "the quick brown fox jumps over the lazy dog and keeps on going ".repeat(4);
    const preview = notificationPreview("Subject", snippet);

    expect(preview.length).toBeLessThanOrEqual(140);
    expect(preview.endsWith("…")).toBe(true);
    // The character before the ellipsis is the end of a word, not a fragment.
    expect(preview).toMatch(/\w…$/);
    expect(preview).not.toContain("  ");
  });

  it("hard-cuts a single very long token", () => {
    // A URL, or a language that does not use spaces: there is no word boundary
    // to break on, and refusing to truncate would blow the 4 kB payload limit.
    const preview = notificationPreview(null, "x".repeat(400));
    expect(preview.length).toBeLessThanOrEqual(140);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("leaves a message that already fits completely alone", () => {
    // No ellipsis on something that was never truncated.
    const preview = notificationPreview("Hello", "Short body");
    expect(preview).toBe("Hello — Short body");
    expect(preview).not.toContain("…");
  });
});
