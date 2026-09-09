import { describe, expect, it } from "vitest";
import {
  describeVapidProblem,
  isValidVapidPrivateKey,
  isValidVapidPublicKey,
} from "./vapid-shape.mjs";
import { generateVapidKeys } from "./vapid.mjs";

/** The exact value that produced the reported bug. */
const ELLIPSIS = "…";

describe("the placeholder that caused the atob failure", () => {
  it("is rejected as a public key", () => {
    /**
     * `VAPID_PUBLIC_KEY="…"` in `.env` is a non-empty string, so the old
     * `Boolean(publicKey && …)` check called the instance configured. The
     * value reached `atob` and Chrome said:
     *
     *     Failed to execute 'atob' on 'Window': The string to be decoded
     *     contains characters outside of the Latin1 range.
     *
     * True, and it mentions neither VAPID nor the file it came from.
     */
    expect(isValidVapidPublicKey(ELLIPSIS)).toBe(false);
    expect(isValidVapidPrivateKey(ELLIPSIS)).toBe(false);
  });

  it("is explained in terms an operator can act on", () => {
    const problem = describeVapidProblem({ publicKey: ELLIPSIS });
    expect(problem).toContain("non-ASCII");
    expect(problem).toContain("placeholder");
    // Says where to get a real one, because that is the next question.
    expect(problem).toContain("sendstack-pwa vapid");
  });

  it("names which half is wrong", () => {
    // "Invalid VAPID key" sent me to check the private key when the public one
    // had an ellipsis in it.
    expect(describeVapidProblem({ publicKey: ELLIPSIS })).toContain("public key");
    expect(describeVapidProblem({ privateKey: ELLIPSIS })).toContain("private key");
  });

  it("never puts a whole secret in the message", () => {
    // These messages go to a server log. A private key quoted in full would
    // outlive the rotation that was supposed to retire it.
    const long = "x".repeat(200);
    const problem = describeVapidProblem({ privateKey: long });
    expect(problem).not.toContain(long);
    expect(problem?.length).toBeLessThan(300);
  });
});

describe("isValidVapidPublicKey", () => {
  it("accepts a real generated key", () => {
    expect(isValidVapidPublicKey(generateVapidKeys().publicKey)).toBe(true);
  });

  it("requires exactly 87 characters", () => {
    // 65 bytes is 21×3+2, so unpadded base64url is 4×22−1. Neither shorter nor
    // longer can decode to an uncompressed P-256 point.
    const key = generateVapidKeys().publicKey;
    expect(key).toHaveLength(87);
    expect(isValidVapidPublicKey(key.slice(0, 86))).toBe(false);
    expect(isValidVapidPublicKey(`${key}A`)).toBe(false);
  });

  it("requires the leading B of an uncompressed point", () => {
    // 0x04 encodes to a leading `B`. A compressed point is a valid EC encoding
    // that the Push API refuses.
    const key = generateVapidKeys().publicKey;
    expect(isValidVapidPublicKey(`A${key.slice(1)}`)).toBe(false);
  });

  it("rejects standard base64", () => {
    // `+`, `/` and `=` decode to the right bytes in some libraries and not
    // others, so the failure is forced to happen at the paste.
    const key = generateVapidKeys().publicKey;
    expect(isValidVapidPublicKey(`B${key.slice(1, 86)}+`)).toBe(false);
    expect(isValidVapidPublicKey(`B${key.slice(1, 86)}=`)).toBe(false);
  });

  it("rejects anything that is not a string", () => {
    // The value arrives from JSON over the wire and from a database column;
    // both can hand over null.
    for (const value of [null, undefined, 0, {}, []]) {
      expect(isValidVapidPublicKey(value), String(value)).toBe(false);
    }
  });
});

describe("isValidVapidPrivateKey", () => {
  it("accepts a real generated key and requires 43 characters", () => {
    const keys = generateVapidKeys();
    expect(keys.privateKey).toHaveLength(43);
    expect(isValidVapidPrivateKey(keys.privateKey)).toBe(true);
    expect(isValidVapidPrivateKey(keys.privateKey.slice(0, 42))).toBe(false);
  });
});

describe("describeVapidProblem", () => {
  it("says nothing when a whole credential set is valid", () => {
    const keys = generateVapidKeys();
    expect(
      describeVapidProblem({ ...keys, subject: "mailto:ops@example.com" }),
    ).toBeNull();
  });

  it("skips a check for a value it was not given", () => {
    // `undefined` means "not supplied". Without this an unconfigured instance
    // would log three complaints on every single request.
    expect(describeVapidProblem({})).toBeNull();
    expect(describeVapidProblem({ publicKey: generateVapidKeys().publicKey })).toBeNull();
  });

  it("distinguishes missing from malformed", () => {
    expect(describeVapidProblem({ publicKey: "" })).toContain("missing");
    expect(describeVapidProblem({ publicKey: "Bxyz" })).toContain("characters");
  });

  it("calls out standard base64 specifically", () => {
    const key = generateVapidKeys().publicKey;
    expect(describeVapidProblem({ publicKey: `${key.slice(0, 86)}=` })).toContain("base64url");
  });

  it("explains a bad subject in terms of the spec", () => {
    // A bare address is accepted by some push services and rejected by
    // others, which shows up as "notifications work for some people".
    const problem = describeVapidProblem({ subject: "ops@example.com" });
    expect(problem).toContain("mailto:");
    expect(problem).toContain("8292");
  });
});
