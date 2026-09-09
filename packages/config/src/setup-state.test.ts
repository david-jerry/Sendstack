import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The SQL text rather than a drizzle query object, so the mock below can tell
 * the three round trips apart by what they ask for.
 */
const execute = vi.fn();

vi.mock("@sendstack/db", () => ({
  db: { execute: (query: unknown) => execute(query) },
  sql: (strings: TemplateStringsArray) => strings.raw.join(" ? "),
}));

const { getSetupState, invalidateSetupState, requireSetupInProgress } = await import(
  "./setup-state"
);

/** Answers as a fully configured installation with one account. */
function configured() {
  execute.mockImplementation((query: string) => {
    if (query.includes("to_regclass")) return [{ has_settings: true, has_user: true }];
    if (query.includes("app_settings")) {
      return [{ setup_completed_at: "2026-01-01T00:00:00Z", setup_step: "done" }];
    }
    return [{ present: true }];
  });
}

/**
 * Answers as an installation that has been migrated but never finished.
 * `withUser` is the account step half-done: the admin exists, `finishSetup`
 * has not run.
 */
function midSetup(options?: { withUser?: boolean }) {
  execute.mockImplementation((query: string) => {
    if (query.includes("to_regclass")) return [{ has_settings: true, has_user: true }];
    if (query.includes("app_settings")) {
      return [{ setup_completed_at: null, setup_step: "resend" }];
    }
    return [{ present: options?.withUser ?? false }];
  });
}

beforeEach(() => {
  process.env.AUTH_SECRET = "x".repeat(32);
  process.env.DATABASE_URL = "postgres://localhost/test";
  execute.mockReset();
  invalidateSetupState();
});

describe("getSetupState", () => {
  it("answers a configured installation without re-querying", async () => {
    configured();

    expect(await getSetupState()).toEqual({ stage: "complete" });
    const afterFirst = execute.mock.calls.length;
    expect(afterFirst).toBe(3);

    expect(await getSetupState()).toEqual({ stage: "complete" });
    expect(await getSetupState()).toEqual({ stage: "complete" });
    // The whole point: three round trips for the first caller, none after.
    expect(execute.mock.calls.length).toBe(afterFirst);
  });

  it("never caches a stage the wizard is still moving through", async () => {
    midSetup();

    expect(await getSetupState()).toEqual({ stage: "incomplete", step: "resend" });
    expect(await getSetupState()).toEqual({ stage: "incomplete", step: "resend" });
    // Six, not three. A cached `incomplete` would leave the wizard showing a
    // step the operator has already finished.
    expect(execute.mock.calls.length).toBe(6);
  });

  it("sees setup finish on the very next call", async () => {
    midSetup();
    expect(await getSetupState()).toEqual({ stage: "incomplete", step: "resend" });

    configured();
    expect(await getSetupState()).toEqual({ stage: "complete" });
  });

  it("re-queries when asked for a fresh answer", async () => {
    configured();
    await getSetupState();
    const cached = execute.mock.calls.length;

    await getSetupState({ fresh: true });
    expect(execute.mock.calls.length).toBe(cached + 3);
  });

  it("re-queries after the cache is invalidated", async () => {
    configured();
    await getSetupState();
    const cached = execute.mock.calls.length;

    invalidateSetupState();
    await getSetupState();
    expect(execute.mock.calls.length).toBe(cached + 3);
  });

  it("stops before touching the database when there is no secret", async () => {
    delete process.env.AUTH_SECRET;
    expect(await getSetupState()).toEqual({ stage: "no-secret" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("reports an unreachable database rather than throwing", async () => {
    execute.mockImplementation(() => {
      throw new Error("connection refused");
    });

    expect(await getSetupState()).toEqual({
      stage: "no-database",
      reason: "connection refused",
    });
  });

  it("does not cache a configured installation that has lost its last account", async () => {
    execute.mockImplementation((query: string) => {
      if (query.includes("to_regclass")) return [{ has_settings: true, has_user: true }];
      if (query.includes("app_settings")) {
        return [{ setup_completed_at: "2026-01-01T00:00:00Z", setup_step: "done" }];
      }
      return [{ present: false }];
    });

    expect(await getSetupState()).toEqual({ stage: "needs-admin" });
    await getSetupState();
    expect(execute.mock.calls.length).toBe(6);
  });

  it("asks whether any account exists, not how many", async () => {
    // This runs on every uncached request. `count(*)` visits every row of a
    // table whose size is irrelevant to the answer.
    configured();
    await getSetupState();
    const userQuery = execute.mock.calls.map(([q]) => String(q)).find((q) => q.includes('"user"'));
    expect(userQuery).toMatch(/EXISTS/);
    expect(userQuery).not.toMatch(/count\(/);
  });
});

/**
 * The guard every setup action runs first. A Server Action is a public POST
 * endpoint regardless of which page renders its form, so "the wizard is not
 * shown any more" protects nothing on its own.
 */
describe("requireSetupInProgress", () => {
  it("throws once setup is complete", async () => {
    configured();
    await expect(requireSetupInProgress()).rejects.toThrow(/already complete/);
  });

  it("ignores the cached `complete` and reads fresh", async () => {
    // The layout cache makes `complete` sticky for 30s. The guard must not
    // trust it in either direction — here it must still be able to *see* that
    // setup has been reopened by the last account being deleted.
    configured();
    await getSetupState();
    execute.mockImplementation((query: string) => {
      if (query.includes("to_regclass")) return [{ has_settings: true, has_user: true }];
      if (query.includes("app_settings")) {
        return [{ setup_completed_at: "2026-01-01T00:00:00Z", setup_step: "done" }];
      }
      return [{ present: false }];
    });

    expect(await getSetupState()).toEqual({ stage: "complete" }); // cached
    await expect(requireSetupInProgress()).resolves.toMatchObject({
      state: { stage: "needs-admin" },
      hasAdmin: false,
    });
  });

  it("lets the wizard through before any account exists", async () => {
    midSetup();
    await expect(requireSetupInProgress()).resolves.toEqual({
      state: { stage: "incomplete", step: "resend" },
      hasAdmin: false,
    });
  });

  it("reports an existing account so the caller can demand a session", async () => {
    midSetup({ withUser: true });
    await expect(requireSetupInProgress()).resolves.toEqual({
      state: { stage: "incomplete", step: "resend" },
      hasAdmin: true,
    });
  });

  it("allows the bootstrap step, which runs before there is a database", async () => {
    delete process.env.DATABASE_URL;
    await expect(requireSetupInProgress()).resolves.toMatchObject({
      state: { stage: "no-database" },
      hasAdmin: false,
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
