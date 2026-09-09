import { beforeEach, describe, expect, it, vi } from "vitest";
import { CLEARED_SECRET, encryptSecret } from "./crypto";

/**
 * An in-memory `app_settings` row and `app_secrets` table, driven through the
 * three drizzle calls `config.ts` actually makes. `vi.hoisted` because
 * `vi.mock` is lifted above every other statement.
 */
const store = vi.hoisted(() => ({
  settings: null as Record<string, unknown> | null,
  secrets: [] as { key: string; ciphertext: string }[],
  inserts: [] as { table: string; values: Record<string, unknown> }[],
  deletes: 0,
}));

vi.mock("@sendstack/db/schema", () => ({
  appSettings: { table: "app_settings", id: "id" },
  appSecrets: { table: "app_secrets", key: "key" },
}));

vi.mock("@sendstack/db", () => {
  const rowsFor = (table: { table: string }) =>
    table.table === "app_settings" ? (store.settings ? [store.settings] : []) : store.secrets;
  return {
    eq: () => true,
    sql: () => "",
    db: {
      select: () => ({
        from: (table: { table: string }) => {
          // `await db.select().from(x)` and `await …from(x).where(…)` both occur.
          const rows = rowsFor(table);
          return Object.assign(Promise.resolve(rows), { where: async () => rows });
        },
      }),
      insert: (table: { table: string }) => ({
        values: (values: Record<string, unknown>) => ({
          onConflictDoUpdate: async () => {
            store.inserts.push({ table: table.table, values });
          },
        }),
      }),
      delete: () => ({
        where: async () => {
          store.deletes += 1;
        },
      }),
      execute: async () => [],
    },
  };
});

const { assertAuthMethodsUsable, clearSecret, getConfig, invalidateConfig, setSecret } =
  await import("./config");

const SEEDED = ["REDIS_URL", "UPSTASH_REDIS_REST_URL", "RESEND_API_KEY", "CLOUDINARY_CLOUD_NAME"];

beforeEach(() => {
  process.env.AUTH_SECRET = "0123456789abcdef0123456789abcdef";
  for (const name of SEEDED) delete process.env[name];
  store.settings = null;
  store.secrets = [];
  store.inserts = [];
  store.deletes = 0;
  invalidateConfig();
});

/**
 * The three states a stored value can be in, and what each means for the
 * environment variable behind it. ARCHITECTURE.md's rule is "the environment
 * never overrides a configured value" — and a value the operator has cleared
 * is configured.
 */
describe("getConfig resolution", () => {
  it("seeds from the environment when nothing was ever stored", async () => {
    process.env.REDIS_URL = "redis://from-env:6379";

    const config = await getConfig({ fresh: true });
    expect(config.redis.url).toBe("redis://from-env:6379");
    expect(config.provenance.redisRestUrl).toBe("environment");
  });

  it("prefers a stored value over the environment", async () => {
    process.env.REDIS_URL = "redis://from-env:6379";
    store.settings = { redisRestUrl: "redis://saved:6379" };

    const config = await getConfig({ fresh: true });
    expect(config.redis.url).toBe("redis://saved:6379");
    expect(config.provenance.redisRestUrl).toBe("database");
  });

  it("does not resurrect a cleared setting from the environment", async () => {
    // THE regression: `updateRealtimeSettings` with a blank URL, on a host
    // that still exports REDIS_URL, used to reconnect on the very next read.
    process.env.REDIS_URL = "redis://from-env:6379";
    store.settings = { redisRestUrl: "" };

    const config = await getConfig({ fresh: true });
    expect(config.redis.url).toBeNull();
    expect(config.provenance.redisRestUrl).toBe("cleared");
  });

  it("applies the same rule to Cloudinary, whose clear path also tombstones", async () => {
    process.env.CLOUDINARY_CLOUD_NAME = "from-env";
    store.settings = { cloudinaryCloudName: "" };

    const config = await getConfig({ fresh: true });
    expect(config.cloudinary.cloudName).toBeNull();
    expect(config.cloudinary.configured).toBe(false);
  });

  it("does not resurrect a cleared secret from the environment", async () => {
    process.env.RESEND_API_KEY = "re_from_env";
    store.secrets = [{ key: "resendApiKey", ciphertext: CLEARED_SECRET }];

    const config = await getConfig({ fresh: true });
    expect(config.resend.apiKey).toBeNull();
    expect(config.provenance.resendApiKey).toBe("cleared");
  });

  it("still seeds a secret that was never stored", async () => {
    process.env.RESEND_API_KEY = "re_from_env";

    const config = await getConfig({ fresh: true });
    expect(config.resend.apiKey).toBe("re_from_env");
    expect(config.provenance.resendApiKey).toBe("environment");
  });

  it("decrypts a stored secret and reports it as saved", async () => {
    process.env.RESEND_API_KEY = "re_from_env";
    store.secrets = [{ key: "resendApiKey", ciphertext: encryptSecret("re_saved") }];

    const config = await getConfig({ fresh: true });
    expect(config.resend.apiKey).toBe("re_saved");
    expect(config.provenance.resendApiKey).toBe("database");
  });

  it("survives one unreadable secret without losing the rest", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    store.secrets = [
      { key: "resendApiKey", ciphertext: "v1.garbage.garbage.garbage" },
      { key: "inngestEventKey", ciphertext: encryptSecret("evt_ok") },
    ];

    const config = await getConfig({ fresh: true });
    expect(config.resend.apiKey).toBeNull();
    expect(config.inngest.eventKey).toBe("evt_ok");
    error.mockRestore();
  });
});

describe("clearSecret", () => {
  it("writes a tombstone rather than deleting the row", async () => {
    await clearSecret("resendApiKey");

    expect(store.deletes).toBe(0);
    expect(store.inserts).toEqual([
      { table: "app_secrets", values: { key: "resendApiKey", ciphertext: CLEARED_SECRET } },
    ]);
  });

  it("is what a blank `setSecret` means too", async () => {
    await setSecret("redisRestToken", "   ");
    expect(store.inserts[0]?.values).toMatchObject({ ciphertext: CLEARED_SECRET });
  });

  it("never hands the marker to the cipher", async () => {
    // Belt and braces: even if a tombstone reached `decryptSecret` it would
    // fail loudly, but the config read must not log an error for it either.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    store.secrets = [{ key: "resendApiKey", ciphertext: CLEARED_SECRET }];
    await getConfig({ fresh: true });
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

/**
 * Shared by the wizard and Settings so the two cannot drift — they had, with
 * two wordings of the same two rules.
 */
describe("assertAuthMethodsUsable", () => {
  const withKey = { appUrl: "https://mail.example.com", resend: { apiKey: "re_x" } };
  const noKey = { appUrl: "https://mail.example.com", resend: { apiKey: null } };
  const plainHttp = { appUrl: "http://mail.example.com", resend: { apiKey: "re_x" } };

  it("refuses to disable every method", () => {
    expect(() =>
      assertAuthMethodsUsable({ emailPassword: false, passkey: false, magicLink: false }, withKey),
    ).toThrow(/at least one/i);
  });

  it("refuses magic links without a sender", () => {
    expect(() =>
      assertAuthMethodsUsable({ emailPassword: true, passkey: false, magicLink: true }, noKey),
    ).toThrow(/Resend key/);
  });

  it("refuses passkeys on a plain-http origin", () => {
    expect(() =>
      assertAuthMethodsUsable({ emailPassword: true, passkey: true, magicLink: false }, plainHttp),
    ).toThrow(/HTTPS/);
  });

  it("exempts localhost, so local development can register a passkey", () => {
    expect(() =>
      assertAuthMethodsUsable(
        { emailPassword: true, passkey: true, magicLink: false },
        { appUrl: "http://localhost:3000", resend: { apiKey: null } },
      ),
    ).not.toThrow();
  });

  it("accepts a configuration that can work", () => {
    expect(() =>
      assertAuthMethodsUsable({ emailPassword: true, passkey: true, magicLink: true }, withKey),
    ).not.toThrow();
  });
});
