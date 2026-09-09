import { describe, expect, it } from "vitest";
import {
  clampPageSize,
  decodeCursor,
  encodeCursor,
  toPage,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "./cursor";

const AT = "2026-09-05 12:34:56.982431+00";
const ID = "0b6b8f8e-2c1a-4f7e-9f1e-2b3c4d5e6f70";

describe("cursors", () => {
  it("round-trips a position exactly", () => {
    // **Microsecond** precision matters, which is why `at` is the raw string
    // Postgres returned and not a `Date`. A `Date` holds milliseconds, so a
    // cursor built through one names a moment before the row it came from —
    // and the boundary row then repeats on an ascending page and every row
    // inside that truncated millisecond is skipped on a descending one.
    const decoded = decodeCursor(encodeCursor({ at: AT, id: ID }));
    expect(decoded?.at).toBe(AT);
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
  // Shaped like what the driver hands back: a timestamp string carrying more
  // precision than a `Date` can hold.
  const rows = Array.from({ length: 4 }, (_, index) => ({
    id: `id-${index}`,
    at: `2026-09-05 00:00:0${index}.98243${index}+00`,
  }));
  // Two functions now: the map produces the API shape, the key reads the raw
  // row — because only the raw row still has the microseconds.
  const map = (row: (typeof rows)[number]) => ({ id: row.id, at: new Date(row.at) });
  const key = (row: (typeof rows)[number]) => ({ at: row.at, id: row.id });

  it("reports no next page when the extra row is absent", () => {
    const page = toPage(rows.slice(0, 3), 3, map, key);
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });

  it("trims the probe row and points at the last kept one", () => {
    // The extra row exists only to answer "is there more" — returning it
    // would show one row twice, at the seam between two pages.
    const page = toPage(rows, 3, map, key);
    expect(page.items).toHaveLength(3);
    expect(page.items.at(-1)?.id).toBe("id-2");
    expect(decodeCursor(page.nextCursor)?.id).toBe("id-2");
  });

  it("handles an empty result", () => {
    const page = toPage([], 3, map, key);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});
