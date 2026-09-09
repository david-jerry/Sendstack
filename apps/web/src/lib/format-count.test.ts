import { describe, expect, it } from "vitest";
import { formatCount, plural } from "./utils";

describe("formatCount", () => {
  it("shows small numbers exactly", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(7)).toBe("7");
    expect(formatCount(999)).toBe("999");
  });

  it("abbreviates thousands with one useful decimal", () => {
    expect(formatCount(1000)).toBe("1k");
    expect(formatCount(1200)).toBe("1.2k");
    expect(formatCount(9999)).toBe("9.9k");
  });

  it("drops the decimal once it stops distinguishing", () => {
    // "12.8k" and "12k" say the same thing in a 20px pill.
    expect(formatCount(12_847)).toBe("12k");
    expect(formatCount(20_000)).toBe("20k");
  });

  it("never overstates", () => {
    // Rounding 999 up to "1k" claims mail that is not there, and a badge that
    // overstates sends people looking for something missing.
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1999)).toBe("1.9k");
    expect(formatCount(19_999)).toBe("19k");
  });

  it("marks a capped count as a floor, not a total", () => {
    // The query stopped counting, so the number is "at least this many".
    expect(formatCount(20_000, true)).toBe("20k+");
    expect(formatCount(500, true)).toBe("500+");
    expect(formatCount(1500, true)).toBe("1.5k+");
  });

  it("keeps going past a million", () => {
    expect(formatCount(1_000_000)).toBe("1m");
    expect(formatCount(2_500_000)).toBe("2.5m");
  });
});

describe("plural", () => {
  it("uses the singular for exactly one", () => {
    expect(plural(1, "message")).toBe("message");
  });

  it("appends s for everything else, zero included", () => {
    expect(plural(0, "message")).toBe("messages");
    expect(plural(2, "message")).toBe("messages");
    // Negative counts are not a real case, but "-1 message" would be worse
    // than "-1 messages" if one ever leaked through.
    expect(plural(-1, "message")).toBe("messages");
  });

  it("takes an explicit form for words an appended s gets wrong", () => {
    expect(plural(1, "body", "bodies")).toBe("body");
    expect(plural(3, "body", "bodies")).toBe("bodies");
  });
});
