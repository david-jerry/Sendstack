import { describe, expect, it } from "vitest";
import { INK, readableOn } from "./theme";

describe("readableOn", () => {
  it("uses white on a dark brand colour", () => {
    expect(readableOn("#18181b")).toBe("#ffffff");
    expect(readableOn("#1d4ed8")).toBe("#ffffff");
  });

  it("uses ink on a pale brand colour", () => {
    // Someone will pick pale yellow, and white on pale yellow is unreadable.
    expect(readableOn("#fef08a")).toBe(INK);
    expect(readableOn("#ffffff")).toBe(INK);
  });

  it("accepts shorthand hex", () => {
    expect(readableOn("#000")).toBe("#ffffff");
    expect(readableOn("#fff")).toBe(INK);
  });

  it("falls back to white on an unparseable value", () => {
    expect(readableOn("not-a-colour")).toBe("#ffffff");
  });
});
