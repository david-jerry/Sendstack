import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * One rule, two surfaces: the wizard's Email step and Settings → Email.
 *
 * The defect this pins down is drift, not absence. Both actions validated the
 * sender configuration, and their copies had stopped agreeing:
 * `saveEmailConfig` refused an address that was not syntactically an address
 * and `updateEmailSettings` never looked, so `weird thing@mail.example.com`
 * was storable through Settings and nowhere else. Nothing downstream noticed —
 * `deliverabilityReport` only asks whether the stored address *ends with* the
 * sending domain — so the first symptom was an opaque Resend rejection on a
 * real campaign.
 *
 * So every assertion below is made against **both** actions in the same test.
 * A rule that holds on one surface and not the other is precisely the bug, and
 * a test that exercised one at a time would have passed while it was live.
 *
 * `@sendstack/shared` is deliberately *not* mocked: `emailConfigSchema` and
 * `brandingFormSchema` are the things under test.
 */
const mocks = vi.hoisted(() => ({
  requireSetupInProgress: vi.fn(),
  requireSession: vi.fn(),
  updateSettings: vi.fn(),
  setSecret: vi.fn(),
  clearSecret: vi.fn(),
  getConfig: vi.fn(),
  applyCloudinarySettings: vi.fn(),
  cloudinaryFromForm: vi.fn(),
}));

vi.mock("@sendstack/config", () => ({
  requireSetupInProgress: mocks.requireSetupInProgress,
  updateSettings: mocks.updateSettings,
  setSecret: mocks.setSecret,
  clearSecret: mocks.clearSecret,
  getConfig: mocks.getConfig,
  applyCloudinarySettings: mocks.applyCloudinarySettings,
  cloudinaryFromForm: mocks.cloudinaryFromForm,
  assertAuthMethodsUsable: vi.fn(),
  pingCloudinary: vi.fn(),
  putBrandingAsset: vi.fn(),
  deleteBrandingAsset: vi.fn(),
}));
vi.mock("@sendstack/auth", () => ({
  requireSession: mocks.requireSession,
  resetAuth: vi.fn(),
}));
vi.mock("@sendstack/email", () => ({ resetResendClient: vi.fn() }));
vi.mock("@sendstack/redis", () => ({
  resetRedisClient: vi.fn(),
  parseRedisTarget: vi.fn(),
  backendFor: vi.fn(),
  RedisConfigError: class extends Error {},
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("resend", () => ({ Resend: vi.fn() }));
vi.mock("postgres", () => ({ default: vi.fn() }));

const setup = await import("./setup");
const settings = await import("./settings");

/** The wizard's fields. A blank key is fine — one is already stored below. */
const wizard = {
  apiKey: "",
  domain: "mail.example.com",
  fromName: "Ada Lovelace",
  webhookSecret: "",
};

/** Settings sends two fields the wizard has no place for. */
const settingsFields = {
  domain: "mail.example.com",
  fromName: "Ada Lovelace",
  postalAddress: "",
  ratePerSecond: 10,
};

function brandingForm(overrides: Record<string, string> = {}): FormData {
  const form = new FormData();
  const values = {
    appName: "Sendstack",
    appUrl: "https://mail.example.com",
    primaryColor: "#18181b",
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.requireSetupInProgress.mockResolvedValue({ hasAdmin: false });
  mocks.requireSession.mockResolvedValue({ user: { id: "u1" } });
  mocks.updateSettings.mockResolvedValue(undefined);
  mocks.setSecret.mockResolvedValue(undefined);
  // A key is already stored, so a blank field is the normal state on both
  // surfaces and the "you cannot send without a key" rule is satisfied.
  mocks.getConfig.mockResolvedValue({ resend: { apiKey: "re_stored" } });
  mocks.applyCloudinarySettings.mockResolvedValue({ ok: true });
  mocks.cloudinaryFromForm.mockReturnValue({
    cloudName: "",
    apiKey: "",
    apiSecret: "",
    folder: "",
  });
});

describe("the sender configuration rule", () => {
  it("refuses a malformed from-address on both surfaces", async () => {
    // The exact value that used to pass through Settings: it ends with the
    // sending domain, so every `endsWith` gate in the codebase waves it on.
    const fromEmail = "weird thing@mail.example.com";

    const wizardResult = await setup.saveEmailConfig({ ...wizard, fromEmail });
    const settingsResult = await settings.updateEmailSettings({ ...settingsFields, fromEmail });

    expect(wizardResult.ok, JSON.stringify(wizardResult)).toBe(false);
    expect(settingsResult.ok, JSON.stringify(settingsResult)).toBe(false);
    // Nothing was written by either, which is the part that mattered: the
    // stored value is what the send path reads.
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("refuses an address that is not on the sending domain on both surfaces", async () => {
    const fromEmail = "ada@elsewhere.example";

    expect((await setup.saveEmailConfig({ ...wizard, fromEmail })).ok).toBe(false);
    expect((await settings.updateEmailSettings({ ...settingsFields, fromEmail })).ok).toBe(false);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("normalises the address it stores on both surfaces", async () => {
    // Invariant 6: addresses are normalised at ingestion boundaries. The
    // wizard lowercased inline, Settings lowercased inline, and the schema
    // does it now for both.
    const fromEmail = "  Ada@Mail.Example.com ";

    expect((await setup.saveEmailConfig({ ...wizard, fromEmail })).ok).toBe(true);
    expect((await settings.updateEmailSettings({ ...settingsFields, fromEmail })).ok).toBe(true);

    for (const call of mocks.updateSettings.mock.calls) {
      expect(call[0]).toMatchObject({ resendFromEmail: "ada@mail.example.com" });
    }
    expect(mocks.updateSettings).toHaveBeenCalledTimes(2);
  });

  it("title-cases the from-name it stores on both surfaces", async () => {
    /**
     * `nameField` said it title-cased and did not. `normalizeName` ran *after*
     * parsing in four separate actions, so the schema validated one value and
     * the database stored another — and the admin account's name, which uses
     * the same field with no post-parse call, was stored exactly as typed.
     * Folding the transform into the field made it one rule; this is what
     * fails if it is pulled back out.
     */
    const fromName = "  acme   mailing   co ";

    const fromEmail = "ada@mail.example.com";
    const a = await setup.saveEmailConfig({ ...wizard, fromEmail, fromName });
    const b = await settings.updateEmailSettings({ ...settingsFields, fromEmail, fromName });
    expect(a.ok, JSON.stringify(a)).toBe(true);
    expect(b.ok, JSON.stringify(b)).toBe(true);

    for (const call of mocks.updateSettings.mock.calls) {
      // Collapsed and cased, not merely trimmed.
      expect(call[0]).toMatchObject({ resendFromName: "Acme Mailing Co" });
    }
    expect(mocks.updateSettings).toHaveBeenCalledTimes(2);
  });

  it("lets Settings clear the sender without dropping the syntax check", async () => {
    // Blank is a legitimate instruction — the deliverability report blocks
    // campaigns while no sender is set — and it is the reason the field is
    // optional rather than required. Optional must not mean unchecked, which
    // is what the test above proves.
    const result = await settings.updateEmailSettings({ ...settingsFields, fromEmail: "   " });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ resendFromEmail: null }),
    );
  });

  it("refuses a webhook secret that is not one of Resend's, on both surfaces", async () => {
    // The wizard checked the `whsec_` prefix through its schema and Settings
    // did not check it at all, so a secret pasted from the wrong field was
    // encrypted and stored, and every webhook then failed its signature check.
    const fromEmail = "ada@mail.example.com";
    const webhookSecret = "not-a-resend-secret";

    expect((await setup.saveEmailConfig({ ...wizard, fromEmail, webhookSecret })).ok).toBe(false);
    expect(
      (await settings.updateEmailSettings({ ...settingsFields, fromEmail, webhookSecret })).ok,
    ).toBe(false);
    expect(mocks.setSecret).not.toHaveBeenCalled();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("refuses a send rate outside the range the send loop can honour", async () => {
    const fromEmail = "ada@mail.example.com";

    for (const ratePerSecond of [0, 1001, 10.5]) {
      const result = await settings.updateEmailSettings({
        ...settingsFields,
        fromEmail,
        ratePerSecond,
      });
      expect(result.ok, String(ratePerSecond)).toBe(false);
    }
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("leaves the send rate and postal address alone when the wizard saves", async () => {
    // The wizard shares this schema and has neither field. An absent value
    // must not reach `updateSettings`, where it would wipe a postal address
    // somebody had already entered and reset the send rate.
    expect((await setup.saveEmailConfig({ ...wizard, fromEmail: "ada@mail.example.com" })).ok).toBe(
      true,
    );
    const patch = mocks.updateSettings.mock.calls[0]?.[0];
    expect(patch).not.toHaveProperty("sendRatePerSecond");
    expect(patch).not.toHaveProperty("postalAddress");
  });

  it("still lets Settings clear the postal address", async () => {
    // Blank is distinguishable from absent, and it means "clear it".
    const result = await settings.updateEmailSettings({
      ...settingsFields,
      fromEmail: "ada@mail.example.com",
      postalAddress: "  \n  ",
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ postalAddress: null }),
    );
  });

  it("keeps the lines of a postal address it stores", async () => {
    const result = await settings.updateEmailSettings({
      ...settingsFields,
      fromEmail: "ada@mail.example.com",
      postalAddress: "  Sendstack Ltd \n\n  1 Example Street \n London  ",
    });

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ postalAddress: "Sendstack Ltd\n1 Example Street\nLondon" }),
    );
  });

  it("will not take the caller's word for a stored key", async () => {
    // `hasStoredKey` decides whether a blank API key is acceptable, and a
    // Server Action is a public endpoint — so it is read from configuration.
    mocks.getConfig.mockResolvedValue({ resend: { apiKey: null } });

    const injected = { ...settingsFields, fromEmail: "ada@mail.example.com", hasStoredKey: true };
    const result = await settings.updateEmailSettings(injected);

    expect(result.ok).toBe(false);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });
});

describe("the branding rule", () => {
  it("strips the app URL's trailing slash on both surfaces", async () => {
    // Every absolute link this instance emits is this value plus a path, so a
    // stored trailing slash becomes `//unsubscribe`. Both actions carried
    // their own strip and the schema — the thing the forms validate against —
    // carried none.
    const form = () => brandingForm({ appUrl: "https://mail.example.com//" });

    expect((await setup.saveBranding(form())).ok).toBe(true);
    expect((await settings.updateBranding(form())).ok).toBe(true);

    expect(mocks.updateSettings).toHaveBeenCalledTimes(2);
    for (const call of mocks.updateSettings.mock.calls) {
      expect(call[0]).toMatchObject({ appUrl: "https://mail.example.com" });
    }
  });

  it("title-cases the workspace name on both surfaces", async () => {
    // Same rule, the other `nameField` consumer.
    expect((await setup.saveBranding(brandingForm({ appName: "acme  mail" }))).ok).toBe(true);
    expect((await settings.updateBranding(brandingForm({ appName: "acme  mail" }))).ok).toBe(true);

    for (const call of mocks.updateSettings.mock.calls) {
      expect(call[0]).toMatchObject({ appName: "Acme Mail" });
    }
    expect(mocks.updateSettings).toHaveBeenCalledTimes(2);
  });

  it("refuses a colour that is not a six-digit hex value on both surfaces", async () => {
    const form = () => brandingForm({ primaryColor: "rebeccapurple" });

    expect((await setup.saveBranding(form())).ok).toBe(false);
    expect((await settings.updateBranding(form())).ok).toBe(false);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("refuses an app URL that is not http(s) on both surfaces", async () => {
    const form = () => brandingForm({ appUrl: "mail.example.com" });

    expect((await setup.saveBranding(form())).ok).toBe(false);
    expect((await settings.updateBranding(form())).ok).toBe(false);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("refuses Cloudinary credentials with no cloud name on both surfaces", async () => {
    // A cross-field rule that lived only in the schema, so neither action
    // enforced it before they started parsing: a key and secret with no cloud
    // name cannot upload anything.
    const form = () => brandingForm({ cloudinaryApiKey: "123", cloudinaryApiSecret: "abc" });

    expect((await setup.saveBranding(form())).ok).toBe(false);
    expect((await settings.updateBranding(form())).ok).toBe(false);
    expect(mocks.applyCloudinarySettings).not.toHaveBeenCalled();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });
});
