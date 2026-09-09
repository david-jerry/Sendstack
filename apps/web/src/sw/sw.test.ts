import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Read as text, not imported.
 *
 * `sw.js` calls `createServiceWorker` at module scope, in a file that only
 * makes sense inside a service worker and is bundled by esbuild rather than by
 * Vite. What these tests protect is not behaviour but the *lists* it passes —
 * and a list can be checked as source.
 *
 * Worth checking because both ways of getting it wrong are silent. A path
 * misspelled in `api` means no offline data, with no error anywhere; a
 * sensitive path added to it means a session token in Cache Storage, with no
 * error anywhere either. The package's own behaviour is the package's problem;
 * this file is about the configuration handed to it.
 */
const here = path.dirname(new URL(import.meta.url).pathname);
const source = readFileSync(path.join(here, "sw.js"), "utf8");
const appRoot = path.resolve(here, "..", "app");

/**
 * The string literals in an array passed as `option: [...]`.
 *
 * A missing option fails the assertion here rather than throwing further down,
 * so renaming one produces "api should be an array literal" instead of a null
 * dereference.
 */
function optionList(name: string): string[] {
  const region = new RegExp(`\\n  ${name}: \\[([^\\]]*)\\]`, "s").exec(source)?.[1];
  expect(region, `${name} should be an array literal in sw.js`).toBeTypeOf("string");
  return Array.from(String(region).matchAll(/"([^"]+)"/g), (match) => String(match[1]));
}

const cacheable = optionList("api");
const media = optionList("media");

describe("the worker's cacheable API allowlist", () => {
  it("names routes that exist", () => {
    // A typo here costs offline support and reports nothing: the route simply
    // never matches, and every list is network-only again.
    for (const pathname of cacheable) {
      const route = path.join(appRoot, pathname, "route.ts");
      expect(existsSync(route), `${pathname} has no route at ${route}`).toBe(true);
    }
  });

  it("covers the list endpoints the app pages through", () => {
    // The four cursor-paginated lists. If a fifth is added and not listed, it
    // silently stops working offline while the other four keep working.
    expect(cacheable).toEqual(
      expect.arrayContaining([
        "/api/inbox/threads",
        "/api/outbound",
        "/api/contacts",
        "/api/campaigns",
      ]),
    );
  });

  it("excludes credentials, mutations and open streams", () => {
    // Sessions must never be stored; a mutation replayed from cache would be a
    // duplicate send; and a strategy wrapped around an SSE response buffers it
    // until it closes, which for a realtime stream is never.
    for (const forbidden of [
      "/api/auth",
      "/api/compose/send",
      "/api/realtime/stream",
      "/api/setup/stream",
      "/api/webhooks/resend",
      "/api/inngest",
      "/api/unsubscribe",
    ]) {
      expect(
        [...cacheable, ...media].some((pathname) => pathname.startsWith(forbidden)),
        forbidden,
      ).toBe(false);
    }
  });
});

describe("the streams kept away from every strategy", () => {
  it("excludes both of them by exact path", () => {
    /**
     * The failure this guards is the least debuggable in the whole worker: a
     * caching strategy wrapped around an SSE response buffers it until the
     * stream closes, so the inbox simply stops updating with nothing in the
     * console to say why.
     */
    const region = /exclude: \(url\) =>([\s\S]*?),\n\n/.exec(source)?.[1];
    expect(region, "sw.js should declare an `exclude` predicate").toBeTypeOf("string");

    for (const stream of ["/api/realtime/stream", "/api/setup/stream"]) {
      expect(String(region)).toContain(stream);
    }
  });

  it("matches every server-sent-events route in the app", async () => {
    // Found by reading the routes rather than by remembering them: a third
    // stream added later would otherwise be cached by default.
    const { readdir, readFile } = await import("node:fs/promises");

    const streams: string[] = [];
    async function walk(dir: string, prefix: string) {
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const child = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(child, `${prefix}/${entry.name}`);
        } else if (entry.name === "route.ts") {
          const body = await readFile(child, "utf8");
          if (body.includes("text/event-stream")) streams.push(prefix);
        }
      }
    }
    await walk(path.join(appRoot, "api"), "/api");

    expect(streams.length).toBeGreaterThan(0);
    for (const stream of streams) expect(source).toContain(stream);
  });
});
