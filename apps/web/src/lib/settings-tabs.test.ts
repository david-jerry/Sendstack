import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS_TAB,
  SETTINGS_TAB_IDS,
  resolveSettingsTab,
} from "./settings-tabs";

describe("resolveSettingsTab", () => {
  it("accepts every tab it advertises", () => {
    // A tab in the list that does not resolve is a rail entry that opens
    // nothing, and nothing anywhere reports it.
    for (const id of SETTINGS_TAB_IDS) {
      expect(resolveSettingsTab(id)).toBe(id);
    }
  });

  it("falls back rather than selecting nothing", () => {
    // An unrecognised value would hide every panel, which looks like a crash.
    expect(resolveSettingsTab("billing")).toBe(DEFAULT_SETTINGS_TAB);
    expect(resolveSettingsTab("")).toBe(DEFAULT_SETTINGS_TAB);
    expect(resolveSettingsTab(undefined)).toBe(DEFAULT_SETTINGS_TAB);
  });

  it("takes the first value when the parameter is repeated", () => {
    // ?tab=email&tab=sign-in arrives as an array.
    expect(resolveSettingsTab(["email", "sign-in"])).toBe("email");
    expect(resolveSettingsTab([])).toBe(DEFAULT_SETTINGS_TAB);
  });

  it("does not match on case or whitespace", () => {
    // Being lenient here would mean the URL written back by the tab strip
    // differs from the one that was read, and Back would loop.
    expect(resolveSettingsTab("Email")).toBe(DEFAULT_SETTINGS_TAB);
    expect(resolveSettingsTab(" email ")).toBe(DEFAULT_SETTINGS_TAB);
  });
});
