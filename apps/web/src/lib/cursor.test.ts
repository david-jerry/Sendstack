import { describe, expect, it } from "vitest";
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  toPage,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "./cursor";

const AT = new Date("2026-09-05T12:34:56.789Z");
const ID = "0b6b8f8e-2c1a-4f7e-9f1e-2b3c4d5e6f70";

describe("cursors", () => {
  it("round-trips a position exactly", () => {
    // Millisecond precision matters: the tie-breaker only helps if the
    // timestamp either side of it is the one the database sorted on.
    const decoded = decodeCursor(encodeCursor({ at: AT, id: ID }));
    expect(decoded?.at.toISOString()).toBe(AT.toISOString());
    expect(decoded?.id).toBe(ID);
  });

  it("survives a query string without escaping", () => {
    const encoded = encodeCursor({ at: AT, id: ID });
    expect(encoded).toBe(encodeURIComponent(encoded));
  });

  it("does not hand the sort key to the client", () => {
    // A readable cursor becomes a public API the moment someone constructs
    // one, and then the sort order cannot change.
    const encoded = encodeCursor({ at: AT, id: ID });
    expect(encoded).not.toContain(ID);
    expect(encoded).not.toContain("2026");
  });

  it("treats anything unreadable as the top of the list", () => {
    // A stale bookmark should show the newest mail, not a 500.
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("not-base64!!")).toBeNull();
    expect(decodeCursor(Buffer.from("{}").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from('{"a":"nonsense","i":"x"}').toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from('{"a":"2026-01-01T00:00:00Z","i":""}').toString("base64url"))).toBeNull();
  });
});

describe("clampPageSize", () => {
  it("defaults rather than trusting the caller", () => {
    expect(clampPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize("abc")).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize(0)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize(-5)).toBe(DEFAULT_PAGE_SIZE);
  });

  it("caps a request that would scan the whole table", () => {
    expect(clampPageSize(999_999)).toBe(MAX_PAGE_SIZE);
    expect(clampPageSize(75)).toBe(75);
  });
});

describe("toPage", () => {
  const rows = Array.from({ length: 4 }, (_, index) => ({
    id: `id-${index}`,
    at: new Date(Date.UTC(2026, 8, 5, 0, 0, index)),
  }));
  const key = (row: (typeof rows)[number]) => ({ at: row.at, id: row.id });

  it("reports no next page when the extra row is absent", () => {
    const page = toPage(rows.slice(0, 3), 3, key);
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });

  it("trims the probe row and points at the last kept one", () => {
    // The extra row exists only to answer "is there more" — returning it
    // would show one row twice, at the seam between two pages.
    const page = toPage(rows, 3, key);
    expect(page.items).toHaveLength(3);
    expect(page.items.at(-1)?.id).toBe("id-2");
    expect(decodeCursor(page.nextCursor)?.id).toBe("id-2");
  });

  it("handles an empty result", () => {
    const page = toPage([], 3, key);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});
