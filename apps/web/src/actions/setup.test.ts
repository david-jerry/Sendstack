import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The guard on every setup action, exercised through the actions themselves.
 *
 * `requireSetupInProgress` is proven to throw on a finished instance in its
 * own test (`packages/config/src/setup-state.test.ts`). What this file proves
 * is the other half: that each action calls it *first*, before touching
 * storage or opening a connection — an action that validated its input, wrote
 * a row and only then asked would be no safer than one that never asked.
 */
const mocks = vi.hoisted(() => ({
  requireSetupInProgress: vi.fn(),
  requireSession: vi.fn(),
  updateSettings: vi.fn(),
  setSecret: vi.fn(),
  postgres: vi.fn(),
}));

vi.mock("@sendstack/config", () => ({
  requireSetupInProgress: mocks.requireSetupInProgress,
  updateSettings: mocks.updateSettings,
  setSecret: mocks.setSecret,
  getConfig: vi.fn(),
  applyCloudinarySettings: vi.fn(),
  cloudinaryFromForm: vi.fn(),
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
vi.mock("postgres", () => ({ default: mocks.postgres }));

const setup = await import("./setup");

/** What the guard sees on an instance where somebody has finished the wizard. */
function setupComplete() {
  mocks.requireSetupInProgress.mockRejectedValue(new Error("Setup is already complete."));
}

/** Mid-wizard. `hasAdmin` is the account step half-done. */
function setupInProgress(hasAdmin: boolean) {
  mocks.requireSetupInProgress.mockResolvedValue({
    state: { stage: "incomplete", step: "jobs" },
    hasAdmin,
  });
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.requireSession.mockResolvedValue({ user: { id: "u1" } });
  mocks.updateSettings.mockResolvedValue(undefined);
  mocks.setSecret.mockResolvedValue(undefined);
});

describe("setup actions once setup is complete", () => {
  beforeEach(setupComplete);

  it("refuses to write anything", async () => {
    await expect(setup.saveJobsConfig({ eventKey: "evt", signingKey: "sig" })).rejects.toThrow(
      /already complete/,
    );
    await expect(setup.finishSetup()).rejects.toThrow(/already complete/);
    await expect(setup.openAccountCreation()).rejects.toThrow(/already complete/);
    await expect(
      setup.saveAuthConfig({ emailPassword: true, passkey: false, magicLink: false }),
    ).rejects.toThrow(/already complete/);
    await expect(setup.saveRealtimeConfig({ url: "", token: "", skip: true })).rejects.toThrow(
      /already complete/,
    );
    await expect(setup.saveBranding(new FormData())).rejects.toThrow(/already complete/);
    await expect(
      setup.saveBootstrap({ databaseUrl: "postgresql://evil/x", authSecret: "x".repeat(40) }),
    ).rejects.toThrow(/already complete/);

    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(mocks.setSecret).not.toHaveBeenCalled();
  });

  it("refuses to open a connection to a caller-supplied database URL", async () => {
    // The SSRF half of the finding: the server must not connect anywhere on
    // an anonymous request to a finished instance.
    await expect(setup.testDatabaseUrl("postgresql://internal-host/db")).rejects.toThrow(
      /already complete/,
    );
    expect(mocks.postgres).not.toHaveBeenCalled();
  });
});

describe("setup actions while the wizard is running", () => {
  it("let an anonymous operator through before any account exists", async () => {
    // There is nobody who *could* be signed in yet.
    setupInProgress(false);

    await expect(setup.saveJobsConfig({ eventKey: "", signingKey: "" })).resolves.toEqual({
      ok: true,
    });
    expect(mocks.requireSession).not.toHaveBeenCalled();
    expect(mocks.updateSettings).toHaveBeenCalledWith({ setupStep: "auth" });
  });

  it("demand a session once an account exists", async () => {
    // Every step can be revisited with Back, so this applies to all of them,
    // not only to the ones that come after account creation in the stepper.
    setupInProgress(true);
    mocks.requireSession.mockRejectedValue(new Error("UNAUTHORIZED"));

    await expect(setup.saveJobsConfig({ eventKey: "evt", signingKey: "" })).rejects.toThrow(
      "UNAUTHORIZED",
    );
    expect(mocks.setSecret).not.toHaveBeenCalled();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("finish with the account's own session", async () => {
    setupInProgress(true);

    await expect(setup.finishSetup()).resolves.toEqual({ ok: true });
    expect(mocks.requireSession).toHaveBeenCalledOnce();
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ allowSignup: false, setupStep: "done" }),
    );
  });

  it("will not finish before an account exists", async () => {
    setupInProgress(false);

    await expect(setup.finishSetup()).resolves.toEqual({
      ok: false,
      error: expect.stringMatching(/account/),
    });
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });
});
