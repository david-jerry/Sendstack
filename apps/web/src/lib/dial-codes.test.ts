import { describe, expect, it } from "vitest";
import {
  COUNTRIES,
  dialOf,
  flagOf,
  guessCountry,
  nameOf,
  splitE164,
} from "./dial-codes";

describe("the country table", () => {
  it("lists every ISO code once", () => {
    // A duplicate would put the same country in the picker twice and make
    // `dialOf` return whichever came first, which is a coin toss.
    const isos = COUNTRIES.map((country) => country.iso);
    expect(new Set(isos).size).toBe(isos.length);
  });

  it("uses uppercase alpha-2 codes throughout", () => {
    // `flagOf` computes from character codes and `Intl.DisplayNames` expects
    // uppercase; a lowercase entry would silently render as text.
    for (const country of COUNTRIES) {
      expect(country.iso, country.iso).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("uses bare digits with no leading zero for every dial code", () => {
    // E.164 forbids a leading zero after the `+`, and the contact schema's
    // regex enforces `\\+[1-9]`. A `+0…` entry would produce a number that
    // cannot be saved.
    for (const country of COUNTRIES) {
      expect(country.dial, country.iso).toMatch(/^[1-9]\d{0,3}$/);
    }
  });

  it("covers enough of the world to be usable", () => {
    // Not an exact count — codes do change — but a truncated list is the
    // failure mode to catch: someone's country simply missing.
    expect(COUNTRIES.length).toBeGreaterThan(200);
  });

  it("gets the well-known codes right", () => {
    const expected = {
      US: "1",
      CA: "1",
      GB: "44",
      NG: "234",
      IN: "91",
      DE: "49",
      FR: "33",
      BR: "55",
      CN: "86",
      JP: "81",
      ZA: "27",
      AU: "61",
      KE: "254",
      GH: "233",
      AE: "971",
      RU: "7",
    };

    for (const [iso, dial] of Object.entries(expected)) {
      expect(dialOf(iso), iso).toBe(dial);
    }
  });

  it("keeps the shared-code countries first in their block", () => {
    // `splitE164` resolves a shared code to the first matching entry, so the
    // ordering is behaviour rather than tidiness: `+1` must read as the US
    // rather than as American Samoa.
    const plusOne = COUNTRIES.filter((country) => country.dial === "1");
    expect(plusOne[0]?.iso).toBe("US");

    const plusSeven = COUNTRIES.filter((country) => country.dial === "7");
    expect(plusSeven[0]?.iso).toBe("RU");
  });
});

describe("flagOf", () => {
  it("maps an ISO code onto its regional indicator pair", () => {
    expect(flagOf("GB")).toBe("🇬🇧");
    expect(flagOf("NG")).toBe("🇳🇬");
    expect(flagOf("US")).toBe("🇺🇸");
  });

  it("falls back to the code rather than to nothing", () => {
    // Windows has never shipped flag glyphs; a blank cell there would leave
    // the picker unreadable.
    expect(flagOf("ZZZ")).toBe("ZZZ");
    expect(flagOf("")).toBe("");
  });
});

describe("nameOf", () => {
  it("returns a human name for a real region", () => {
    expect(nameOf("GB", "en")).toBe("United Kingdom");
    expect(nameOf("NG", "en")).toBe("Nigeria");
  });

  it("survives a region the platform does not know", () => {
    // Kosovo has a calling code and no ISO assignment, and
    // `Intl.DisplayNames` throws on it rather than returning undefined.
    expect(() => nameOf("XK", "en")).not.toThrow();
    expect(nameOf("XK", "en")).toBeTruthy();
  });
});

describe("splitE164", () => {
  it("splits a number into its country and the rest", () => {
    expect(splitE164("+14155552671")).toEqual({ iso: "US", national: "4155552671" });
    expect(splitE164("+2348012345678")).toEqual({ iso: "NG", national: "8012345678" });
    expect(splitE164("+442071838750")).toEqual({ iso: "GB", national: "2071838750" });
  });

  it("prefers the longest matching code", () => {
    // Antigua's +1268 sits inside the United States' +1. Matching shortest
    // first would file every Caribbean number under the US.
    expect(splitE164("+12685551234")).toEqual({ iso: "AG", national: "5551234" });
  });

  it("returns null for anything that is not E.164", () => {
    expect(splitE164("")).toBeNull();
    expect(splitE164("4155552671")).toBeNull();
    expect(splitE164("+999999")).toBeNull();
  });

  it("round-trips through the dial code it reported", () => {
    // The property the component depends on: whatever this splits, joining the
    // halves back together has to give the original string.
    for (const number of ["+14155552671", "+2348012345678", "+61412345678", "+7 9123456789".replace(/\s/g, "")]) {
      const parsed = splitE164(number);
      expect(parsed, number).not.toBeNull();
      expect(`+${dialOf(parsed!.iso)}${parsed!.national}`).toBe(number);
    }
  });
});

describe("guessCountry", () => {
  it("reads the region out of a language tag", () => {
    expect(guessCountry("en-GB")).toBe("GB");
    expect(guessCountry("pt-BR")).toBe("BR");
  });

  it("infers a region from a bare language", () => {
    // `maximize()` is what turns "ja" into "ja-Jpan-JP". Without it a browser
    // set to a plain language would always fall through to the default.
    expect(guessCountry("ja")).toBe("JP");
  });

  it("falls back rather than throwing on nonsense", () => {
    expect(guessCountry("not a tag")).toBe("US");
    expect(guessCountry("", "GB")).toBe("GB");
  });

  it("never returns a region with no dial code", () => {
    // The picker's value is an ISO code it must be able to price; returning
    // one that is not in the table would render an empty select.
    for (const tag of ["en-GB", "ar-EG", "zh-Hant-TW", "en-150", "es-419"]) {
      expect(dialOf(guessCountry(tag)), tag).not.toBeNull();
    }
  });
});
