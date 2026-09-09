import { describe, expect, it } from "vitest";
import { reconcileCloudinary } from "./cloudinary-settings";

const STORED = {
  fromEnv: { cloudName: "dt5xelkje", apiKey: "123456789012345", apiSecret: "s3cr3t" },
  none: { cloudName: null, apiKey: null, apiSecret: null },
};

const form = (over: Partial<Parameters<typeof reconcileCloudinary>[0]> = {}) => ({
  cloudName: "",
  apiKey: "",
  apiSecret: "",
  folder: "",
  ...over,
});

describe("reconcileCloudinary", () => {
  it("accepts a submission whose secret fields are blank because they are already stored", () => {
    // THE regression this file exists for. Credentials come from .env, so the
    // wizard renders the cloud name in a visible input and leaves the password
    // fields empty — as every password field must be. Requiring all three
    // rejected the most common setup path outright.
    const decision = reconcileCloudinary(form({ cloudName: "dt5xelkje" }), STORED.fromEnv);

    expect(decision.action).toBe("save");
    if (decision.action !== "save") return;
    expect(decision.apiKey).toBe("123456789012345");
    expect(decision.apiSecret).toBe("s3cr3t");
    // Nothing changed, so there is nothing to re-verify.
    expect(decision.needsPing).toBe(false);
    // And nothing to rewrite — the stored secrets are already correct.
    expect(decision.writeApiKey).toBe(false);
    expect(decision.writeApiSecret).toBe(false);
  });

  it("uses a newly typed key over the stored one, and verifies it", () => {
    const decision = reconcileCloudinary(
      form({ cloudName: "dt5xelkje", apiKey: "999999999999999" }),
      STORED.fromEnv,
    );
    expect(decision).toMatchObject({
      action: "save",
      apiKey: "999999999999999",
      apiSecret: "s3cr3t",
      needsPing: true,
      writeApiKey: true,
      writeApiSecret: false,
    });
  });

  it("verifies when the cloud name changes, even with stored secrets", () => {
    const decision = reconcileCloudinary(form({ cloudName: "other-cloud" }), STORED.fromEnv);
    expect(decision).toMatchObject({ action: "save", needsPing: true });
  });

  it("errors when a cloud name is given but nothing is stored", () => {
    const decision = reconcileCloudinary(form({ cloudName: "dt5xelkje" }), STORED.none);
    expect(decision.action).toBe("error");
    if (decision.action !== "error") return;
    expect(decision.error).toMatch(/API key and secret/);
  });

  it("accepts a complete first-time submission", () => {
    const decision = reconcileCloudinary(
      form({ cloudName: "c", apiKey: "k", apiSecret: "s", folder: "brand" }),
      STORED.none,
    );
    expect(decision).toMatchObject({
      action: "save",
      folder: "brand",
      needsPing: true,
      writeApiKey: true,
      writeApiSecret: true,
    });
  });

  it("defaults the folder rather than writing an empty one", () => {
    const decision = reconcileCloudinary(form({ cloudName: "dt5xelkje" }), STORED.fromEnv);
    expect(decision).toMatchObject({ action: "save", folder: "sendstack" });
  });

  it("does nothing when the form is empty and nothing is stored", () => {
    // Cloudinary is optional — an untouched form is not an error.
    expect(reconcileCloudinary(form(), STORED.none)).toEqual({ action: "none" });
  });

  it("clears when a stored cloud name is deliberately emptied", () => {
    expect(reconcileCloudinary(form(), STORED.fromEnv)).toEqual({ action: "clear" });
  });

  it("rejects a key or secret with no cloud name", () => {
    // Far more likely a half-filled form than an intent to configure.
    const decision = reconcileCloudinary(form({ apiKey: "k" }), STORED.none);
    expect(decision.action).toBe("error");
    if (decision.action !== "error") return;
    expect(decision.error).toMatch(/cloud name/);
  });

  it("trims whitespace from pasted values", () => {
    const decision = reconcileCloudinary(
      form({ cloudName: "  dt5xelkje  ", apiKey: " k ", apiSecret: " s " }),
      STORED.none,
    );
    expect(decision).toMatchObject({
      action: "save",
      cloudName: "dt5xelkje",
      apiKey: "k",
      apiSecret: "s",
    });
  });

  it("treats a whitespace-only secret as blank, not as a new value", () => {
    const decision = reconcileCloudinary(
      form({ cloudName: "dt5xelkje", apiSecret: "   " }),
      STORED.fromEnv,
    );
    expect(decision).toMatchObject({ action: "save", apiSecret: "s3cr3t", writeApiSecret: false });
  });
});
