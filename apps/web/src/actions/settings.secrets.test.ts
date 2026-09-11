import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A blank credential field means **keep the stored one**, on every writer.
 *
 * This was always true and was never asserted, which was tolerable while a
 * person had to press Save: they saw the empty box, and a mistake cost one
 * click to undo. Settings now autosave, so the Email section writes itself
 * repeatedly with `apiKey: ""` and `webhookSecret: ""` while somebody edits
 * the sending domain beside them. If blank ever came to mean "clear", the
 * first keystroke in an unrelated field would silently destroy the Resend
 * credentials and every send after it would fail.
 *
 * So the property this file pins down is not a nicety — it is the thing that
 * makes autosaving a form containing write-only secrets safe at all.
 */
const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getConfig: vi.fn(),
  setSecret: vi.fn(),
  clearSecret: vi.fn(),
  updateSettings: vi.fn(),
  verifyResendKey: vi.fn(),
}));

vi.mock("@sendstack/auth", () => ({ requireSession: mocks.requireSession, resetAuth: vi.fn() }));
vi.mock("@sendstack/config", () => ({
  getConfig: mocks.getConfig,
  setSecret: mocks.setSecret,
  clearSecret: mocks.clearSecret,
  updateSettings: mocks.updateSettings,
  applyCloudinarySettings: vi.fn(),
  assertAuthMethodsUsable: vi.fn(),
  cloudinaryFromForm: vi.fn(),
  deleteBrandingAsset: vi.fn(),
  putBrandingAsset: vi.fn(),
}));
vi.mock("@sendstack/email", () => ({
  resetResendClient: vi.fn(),
  verifyResendKey: mocks.verifyResendKey,
}));
vi.mock("@sendstack/redis", () => ({ resetRedisClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const settings = await import("./settings");

/** The shape the Email section sends on an ordinary, non-secret edit. */
const emailFields = {
  domain: "mail.example.com",
  fromEmail: "hello@mail.example.com",
  fromName: "Acme",
  postalAddress: "1 High Street",
  ratePerSecond: 10,
};

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.requireSession.mockResolvedValue({ user: { id: "u1" } });
  mocks.updateSettings.mockResolvedValue(undefined);
  mocks.setSecret.mockResolvedValue(undefined);
  // An instance that is already configured — the only state in which a
  // blank field can mean "keep", since there is something to keep.
  mocks.getConfig.mockResolvedValue({ resend: { apiKey: "re_stored" } });
  mocks.verifyResendKey.mockResolvedValue({ ok: true, domains: ["mail.example.com"] });
});

describe("updateEmailSettings", () => {
  it("writes no secret when both credential fields are blank", async () => {
    const result = await settings.updateEmailSettings({
      ...emailFields,
      apiKey: "",
      webhookSecret: "",
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.setSecret).not.toHaveBeenCalled();
    // And no pointless round trip to Resend for a key nobody supplied.
    expect(mocks.verifyResendKey).not.toHaveBeenCalled();
    // The ordinary fields still saved, which is the whole point of the call.
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1);
  });

  it("treats whitespace as blank rather than as a key", async () => {
    await settings.updateEmailSettings({ ...emailFields, apiKey: "   ", webhookSecret: "  " });

    expect(mocks.setSecret).not.toHaveBeenCalled();
  });

  it("stores a key that Resend accepts", async () => {
    await settings.updateEmailSettings({ ...emailFields, apiKey: "re_live_key" });

    expect(mocks.verifyResendKey).toHaveBeenCalledWith("re_live_key");
    expect(mocks.setSecret).toHaveBeenCalledWith("resendApiKey", "re_live_key");
  });

  it("stores nothing when Resend rejects the key", async () => {
    mocks.verifyResendKey.mockResolvedValue({ ok: false, error: "API key is invalid" });

    const result = await settings.updateEmailSettings({ ...emailFields, apiKey: "re_wrong" });

    expect(result.ok).toBe(false);
    expect(mocks.setSecret).not.toHaveBeenCalled();
    /**
     * And the ordinary fields are not written either. A rejected save must
     * be wholly rejected: half-applying it would leave the section showing
     * "Not saved" over a domain that had in fact been changed.
     */
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });
});

describe("the other credential writers", () => {
  it("updateJobSettings ignores blank keys", async () => {
    await settings.updateJobSettings({ eventKey: "", signingKey: "" });
    expect(mocks.setSecret).not.toHaveBeenCalled();

    await settings.updateJobSettings({ eventKey: "sk_event" });
    expect(mocks.setSecret).toHaveBeenCalledWith("inngestEventKey", "sk_event");
  });
});
