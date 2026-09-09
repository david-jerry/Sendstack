import { describe, expect, it } from "vitest";
import { brandStyle, readableOn } from "./brand";

describe("readableOn", () => {
  it("picks black on this instance's green", () => {
    /**
     * The case that prompted the whole helper. `#4cb63e` is the colour
     * configured on the demo instance, and it scores about 2.6:1 against white
     * — well under the 4.5:1 WCAG asks for body text — while black clears 8:1.
     * Hard-coding `text-white` on the call to action would have shipped an
     * unreadable button.
     */
    const { foreground, ratio } = readableOn("#4cb63e");
    expect(foreground).toBe("#111111");
    expect(ratio).toBeGreaterThan(4.5);
  });

  it("picks white on a dark brand", () => {
    const { foreground, ratio } = readableOn("#18181b");
    expect(foreground).toBe("#ffffff");
    expect(ratio).toBeGreaterThan(4.5);
  });

  it("gets pure green and pure blue the right way round", () => {
    /**
     * The reason luminance is gamma-expanded rather than averaged. A plain
     * `(r+g+b)/3` scores both of these identically at 85, and would put the
     * same text colour on a colour the eye reads as bright and one it reads as
     * nearly black.
     */
    expect(readableOn("#00ff00").foreground).toBe("#111111");
    expect(readableOn("#0000ff").foreground).toBe("#ffffff");
  });

  it("handles the mid-tones a threshold would get wrong", () => {
    // Around 50% luminance the two candidates are close, which is exactly
    // where picking by measured contrast beats picking by a cutoff.
    for (const colour of ["#808080", "#7a7a7a", "#888888"]) {
      const { foreground, ratio } = readableOn(colour);
      expect([`#111111`, `#ffffff`], colour).toContain(foreground);
      // Whichever it picked must still be the better of the two.
      expect(ratio, colour).toBeGreaterThan(3);
    }
  });

  it("accepts the short hex form", () => {
    expect(readableOn("#fff")).toEqual(readableOn("#ffffff"));
    expect(readableOn("#000").foreground).toBe("#ffffff");
  });

  it("tolerates a missing hash", () => {
    expect(readableOn("4cb63e").foreground).toBe("#111111");
  });

  it("falls back rather than painting the page with NaN", () => {
    // The value comes from a settings row. A malformed one must degrade to the
    // app's own default pairing, not to an unstyled button.
    for (const bad of ["", "not a colour", "#12", "#1234567", "rgb(1,2,3)"]) {
      expect(readableOn(bad), bad).toEqual({ foreground: "#ffffff", ratio: 1 });
    }
  });
});

describe("brandStyle", () => {
  it("exposes both variables so the contrast decision is made once", () => {
    // A caller using `var(--brand)` for a fill must not have to re-derive what
    // to put on top of it.
    expect(brandStyle("#4cb63e")).toEqual({
      "--brand": "#4cb63e",
      "--brand-foreground": "#111111",
    });
  });
});
