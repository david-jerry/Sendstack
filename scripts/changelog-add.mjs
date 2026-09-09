#!/usr/bin/env node
/**
 * Interactive helper for `pnpm changelog:add`.
 *
 * Two things are easy to get wrong by hand and both are cheap to fix with a
 * prompt: the Keep a Changelog category has to be one of six exact headings
 * in a fixed order, and a first-time contributor's row in CONTRIBUTORS.md
 * needs the same three columns every time. Asking beats reviewing PRs for
 * formatting nits.
 *
 * Only patch-level changes are skipped by default — CHANGELOG.md tracks user-
 * facing behaviour, and "fixed a typo in a comment" is noise a reader has to
 * scroll past to find the change that affects them.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHANGELOG_PATH = path.join(root, "CHANGELOG.md");
const CONTRIBUTORS_PATH = path.join(root, "CONTRIBUTORS.md");

// Fixed Keep a Changelog order — new headings are inserted to match it
// rather than appended, so the file never drifts into an arbitrary order.
const CATEGORIES = ["Added", "Changed", "Deprecated", "Removed", "Fixed", "Security"];

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (question) => rl.question(question);

async function main() {
  console.log("Sendstack changelog + contributor helper\n");

  const bump = (await ask("Semver impact — major, minor, or patch? [minor] ")).trim().toLowerCase() || "minor";
  if (!["major", "minor", "patch"].includes(bump)) {
    console.error(`Unrecognised value "${bump}" — expected major, minor, or patch.`);
    process.exitCode = 1;
    rl.close();
    return;
  }

  if (bump === "patch") {
    const proceed = (await ask(
      "Patch-level changes usually don't need a changelog entry (typos, comments, internal refactors with no visible behaviour change). Add one anyway? [y/N] ",
    ))
      .trim()
      .toLowerCase();
    if (proceed !== "y" && proceed !== "yes") {
      console.log("Skipped — nothing written.");
      rl.close();
      return;
    }
  }

  console.log(`\nCategory — one of: ${CATEGORIES.join(", ")}`);
  const categoryInput = (await ask("Category: ")).trim();
  const category = CATEGORIES.find((c) => c.toLowerCase() === categoryInput.toLowerCase());
  if (!category) {
    console.error(`Unrecognised category "${categoryInput}" — expected one of: ${CATEGORIES.join(", ")}.`);
    process.exitCode = 1;
    rl.close();
    return;
  }

  const description = (await ask("One-line description of the change: ")).trim();
  if (!description) {
    console.error("A description is required.");
    process.exitCode = 1;
    rl.close();
    return;
  }

  const name = (await ask("Your name: ")).trim();
  const githubHandle = (await ask("Your GitHub handle (without @): ")).trim().replace(/^@/, "");
  if (!name || !githubHandle) {
    console.error("Both name and GitHub handle are required.");
    process.exitCode = 1;
    rl.close();
    return;
  }

  await addChangelogEntry({ category, description, githubHandle });
  await addContributorRow({ name, githubHandle });

  console.log("\nDone — review the diff in CHANGELOG.md and CONTRIBUTORS.md before committing.");
  rl.close();
}

async function addChangelogEntry({ category, description, githubHandle }) {
  const original = await readFile(CHANGELOG_PATH, "utf8");
  const bullet = `- ${description} ([@${githubHandle}](https://github.com/${githubHandle}))`;

  const unreleasedMatch = original.match(/^## \[Unreleased\]\n/m);
  if (!unreleasedMatch) {
    throw new Error('CHANGELOG.md has no "## [Unreleased]" section — was it renamed or already released?');
  }
  const unreleasedStart = unreleasedMatch.index + unreleasedMatch[0].length;
  const nextReleaseMatch = original.slice(unreleasedStart).match(/^## \[/m);
  const unreleasedEnd = nextReleaseMatch ? unreleasedStart + nextReleaseMatch.index : original.length;

  const before = original.slice(0, unreleasedStart);
  const unreleasedBody = original.slice(unreleasedStart, unreleasedEnd);
  const after = original.slice(unreleasedEnd);

  const heading = `### ${category}`;
  const headingMatch = unreleasedBody.match(new RegExp(`^${heading}\\n`, "m"));

  let newUnreleasedBody;
  if (headingMatch) {
    // Insert as the first bullet under the existing heading.
    const insertAt = headingMatch.index + headingMatch[0].length;
    newUnreleasedBody = unreleasedBody.slice(0, insertAt) + `${bullet}\n` + unreleasedBody.slice(insertAt);
  } else {
    // No entries under this category yet — insert the heading in canonical
    // order among whichever category headings already exist.
    const laterCategories = CATEGORIES.slice(CATEGORIES.indexOf(category) + 1);
    let insertAt = unreleasedBody.length;
    for (const later of laterCategories) {
      const laterMatch = unreleasedBody.match(new RegExp(`^### ${later}\\n`, "m"));
      if (laterMatch) {
        insertAt = laterMatch.index;
        break;
      }
    }
    const block = `${heading}\n${bullet}\n\n`;
    newUnreleasedBody = unreleasedBody.slice(0, insertAt) + block + unreleasedBody.slice(insertAt);
  }

  await writeFile(CHANGELOG_PATH, before + newUnreleasedBody + after);
}

async function addContributorRow({ name, githubHandle }) {
  const original = await readFile(CONTRIBUTORS_PATH, "utf8");

  const alreadyListed = new RegExp(`\\| *${escapeRegExp(name)} *\\|.*@${escapeRegExp(githubHandle)}\\b`, "i").test(
    original,
  );
  if (alreadyListed) {
    console.log(`${name} (@${githubHandle}) is already in CONTRIBUTORS.md — leaving it as is.`);
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const row = `| ${name} | [@${githubHandle}](https://github.com/${githubHandle}) | ${today} |\n`;

  const headerMatch = original.match(/^\|---\|---\|---\|\n/m);
  if (!headerMatch) {
    throw new Error("CONTRIBUTORS.md table header not found — was the table reshaped?");
  }
  const insertAt = headerMatch.index + headerMatch[0].length;
  const updated = original.slice(0, insertAt) + row + original.slice(insertAt);
  await writeFile(CONTRIBUTORS_PATH, updated);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
  rl.close();
});
