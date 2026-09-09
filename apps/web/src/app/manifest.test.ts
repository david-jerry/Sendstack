import { existsSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** `vi.hoisted`, because `vi.mock` is lifted above every other statement. */
const config = vi.hoisted(() => ({
  setupState: { stage: "complete" } as { stage: string },
  appConfig: { appName: "Acme Mail", primaryColor: "#4f46e5" },
}));

vi.mock("@sendstack/config", () => ({
  getSetupState: async () => config.setupState,
  getConfig: async () => config.appConfig,
}));

const manifest = (await import("./manifest")).default;

const publicDir = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
  "..",
  "public",
);

/**
 * Whether a browser will offer to install this.
 *
 * The criteria are not a matter of taste — Chromium, Edge and Samsung Internet
 * all gate `beforeinstallprompt` on them, and Chromium's list is: a manifest
 * served over HTTPS with a `name` or `short_name`, a `start_url`, a `display`
 * of `standalone`, `fullscreen` or `minimal-ui`, and at least a 192px and a
 * 512px icon. Miss one and the install row never appears, with nothing said
 * anywhere.
 *
 * Tested rather than trusted because every field here comes from settings or
 * a default, and any of them could be edited into something that silently
 * fails the check.
 */
describe("the web app manifest", () => {
  beforeEach(() => {
    config.setupState = { stage: "complete" };
    config.appConfig = { appName: "Acme Mail", primaryColor: "#4f46e5" };
  });

  it("meets every installability criterion", async () => {
    const result = await manifest();

    expect(result.name).toBeTruthy();
    expect(result.short_name).toBeTruthy();
    expect(result.start_url).toBeTruthy();
    expect(["standalone", "fullscreen", "minimal-ui"]).toContain(result.display);

    const sizes = (result.icons ?? []).map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  it("ships the icon files it promises", async () => {
    /**
     * A manifest naming an icon that 404s fails installability in exactly the
     * same silent way as omitting it. The paths are relative to `public/`, so
     * this is checkable on disk.
     */
    const result = await manifest();

    for (const icon of result.icons ?? []) {
      const file = path.join(publicDir, String(icon.src).replace(/^\//, ""));
      expect(existsSync(file), `${icon.src} is not in public/`).toBe(true);
    }
  });

  it("declares a maskable icon as well as a plain one", async () => {
    // Android crops a non-maskable icon into the launcher's shape, which on a
    // circular mask eats the corners of a square logo.
    const purposes = (await manifest()).icons?.map((icon) => icon.purpose) ?? [];
    expect(purposes).toContain("maskable");
    expect(purposes).toContain("any");
  });

  it("keeps short_name short enough for a home screen", async () => {
    // Android truncates past roughly twelve characters, and a truncated name
    // under an icon is how an app looks unfinished before it is opened.
    config.appConfig = { appName: "An Extremely Long Product Name", primaryColor: "#000" };
    const result = await manifest();

    expect(result.short_name!.length).toBeLessThanOrEqual(12);
    // The full name is still available for the install dialog and the store.
    expect(result.name).toBe("An Extremely Long Product Name");
  });

  it("starts in the mailbox rather than on a redirect", async () => {
    // `/` only exists to decide where to send you, so starting there costs the
    // installed app a round trip on every launch.
    expect((await manifest()).start_url).toBe("/inbox");
  });

  it("takes its name and colour from settings", async () => {
    const result = await manifest();
    expect(result.name).toBe("Acme Mail");
    expect(result.theme_color).toBe("#4f46e5");
  });

  it("is still installable before the wizard has been finished", async () => {
    /**
     * The manifest route is reachable during setup, and a manifest that 500s
     * makes the app un-installable with no visible error. Defaults are fine —
     * an unconfigured instance still deserves to be installable.
     */
    config.setupState = { stage: "needs-migration" };
    const result = await manifest();

    expect(result.name).toBeTruthy();
    expect(result.icons?.length).toBeGreaterThan(0);
  });

  it("survives configuration that throws", async () => {
    vi.resetModules();
    vi.doMock("@sendstack/config", () => ({
      getSetupState: async () => {
        throw new Error("no database");
      },
      getConfig: async () => {
        throw new Error("no database");
      },
    }));

    const fallback = (await import("./manifest")).default;
    await expect(fallback()).resolves.toMatchObject({ name: "Sendstack" });
    vi.doUnmock("@sendstack/config");
  });
});
