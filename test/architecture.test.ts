import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every flow-critical surface has a named owner in the ownership matrix.
 *
 * `docs/ARCHITECTURE.md` § Bounded contexts assigns each Server Action, API
 * route and background job to exactly one context, with its aggregate and the
 * tests that prove its invariants. A matrix is only worth writing down if it
 * cannot silently go stale, and the way it goes stale is somebody adding a
 * fourteenth API route — which is a new place a send can happen, or a new
 * writer of a monotonic column — and nobody noticing it belongs to nobody.
 *
 * So this fails on a new surface rather than on a wrong one. It cannot check
 * that the *assignment* is right; that is what review is for. It checks that
 * an assignment was made at all, which is the part a person forgets.
 *
 * Deliberately not a database suite: it reads the tree and a markdown file, so
 * it runs everywhere, including on a contributor's first clone.
 */

const root = join(import.meta.dirname, "..");

/** The matrix rows, as the set of code paths they name. */
function matrixText(): string {
  const doc = readFileSync(join(root, "docs/ARCHITECTURE.md"), "utf8");
  const start = doc.indexOf("## Bounded contexts");
  expect(start, "docs/ARCHITECTURE.md must contain a Bounded contexts section").toBeGreaterThan(-1);

  // Up to the next top-level heading, so an unrelated later mention of a file
  // cannot stand in for a matrix row.
  const rest = doc.slice(start + 1);
  const end = rest.indexOf("\n## ");
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * API routes are named by their directory, not their file.
 *
 * Every one of them is `route.ts`, so the matrix says `api/campaigns` and
 * `api/webhooks/resend` — which is also how a person refers to them.
 */
/** Every file under `dir`, recursively, as paths relative to the repo root. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

/**
 * No glob dependency on purpose.
 *
 * A test that guards the architecture should not be the reason a package is
 * added to the tree, and `readdirSync` answers this in nine lines. `relative`
 * keeps the labels platform-independent.
 */
function surfaces(): { label: string; kind: string }[] {
  const found: { label: string; kind: string }[] = [];

  for (const file of walk("apps/web/src/actions")) {
    if (file.includes(".test.") || !file.endsWith(".ts")) continue;
    found.push({ label: relative("apps/web/src", file).replace(/\.ts$/, ""), kind: "action" });
  }

  for (const file of walk("apps/web/src/app/api")) {
    if (!file.endsWith("/route.ts")) continue;
    found.push({ label: relative("apps/web/src/app", file).replace(/\/route\.ts$/, ""), kind: "route" });
  }

  for (const file of walk("packages/jobs/src/functions")) {
    if (file.includes(".test.") || !file.endsWith(".ts")) continue;
    found.push({ label: relative("packages/jobs/src", file).replace(/\.ts$/, ""), kind: "job" });
  }

  return found;
}

describe("the ownership matrix", () => {
  it("covers every Server Action, API route and job", () => {
    const matrix = matrixText();
    const all = surfaces();

    // A guard on the guard: if the globs stop matching, every assertion below
    // passes vacuously and the test proves nothing.
    expect(all.length, "the globs must find the surfaces they are meant to check")
      .toBeGreaterThan(25);

    /**
     * The forms a matrix row may legitimately take for one surface.
     *
     * Three, because writing every one out longhand would make the matrix
     * worse rather than more precise:
     *
     *  - the path itself (`api/webhooks/resend`, `actions/campaigns`);
     *  - the file (`campaigns.ts`), which is how the matrix names actions;
     *  - a wildcard over the family (`api/avatars/*` covers
     *    `api/avatars/[userId]`, and `api/branding/*` covers both branding
     *    routes) — a row about "the branding asset routes" is one decision,
     *    not two, and splitting it would invite the two halves to drift.
     */
    const accepted = (label: string): string[] => {
      const parts = label.split("/");
      const forms = [label, `${parts[parts.length - 1]}.ts`];
      for (let depth = parts.length - 1; depth > 0; depth -= 1) {
        forms.push(`${parts.slice(0, depth).join("/")}/*`);
      }
      return forms;
    };

    const orphans = all.filter(
      ({ label }) => !accepted(label).some((form) => matrix.includes(form)),
    );

    expect(
      orphans.map((o) => `${o.kind} ${o.label}`).sort(),
      "add a row to the ownership matrix in docs/ARCHITECTURE.md for each of these",
    ).toEqual([]);
  });

  it("names the eight contexts", () => {
    const matrix = matrixText();
    for (const context of [
      "Identity & Access",
      "Contact & Audience",
      "Suppression & Deliverability",
      "Campaign Orchestration",
      "Delivery Execution",
      "Inbound Processing",
      "Realtime Projection",
      "Configuration",
    ]) {
      expect(matrix, `the matrix must still define ${context}`).toContain(context);
    }
  });
});
