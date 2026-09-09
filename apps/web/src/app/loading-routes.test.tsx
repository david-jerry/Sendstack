import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useSelectedLayoutSegment: () => null,
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/inbox",
}));

import RootLoading from "./loading";
import SetupLoading from "./setup/loading";
import AppLoading from "./(app)/loading";
import InboxThreadLoading from "./(app)/inbox/[id]/loading";
import StarredThreadLoading from "./(app)/starred/[id]/loading";
import ArchiveThreadLoading from "./(app)/archive/[id]/loading";
import SpamThreadLoading from "./(app)/spam/[id]/loading";
import SentPreviewLoading from "./(app)/sent/[id]/loading";
import DraftPreviewLoading from "./(app)/drafts/[id]/loading";
import ContactsLoading from "./(app)/contacts/loading";
import CampaignsLoading from "./(app)/campaigns/loading";
import CampaignLoading from "./(app)/campaigns/[id]/loading";
import ListsLoading from "./(app)/lists/loading";
import SuppressionsLoading from "./(app)/suppressions/loading";
import SettingsLoading from "./(app)/settings/loading";

/**
 * Every `loading.tsx` renders, and renders something.
 *
 * These files are only reached when a route is slow, which locally is almost
 * never — the queries behind them resolve in single-digit milliseconds — so a
 * broken one would sit undiscovered until it appeared in front of somebody on
 * a bad connection.
 *
 * Listed explicitly rather than globbed. A glob is shorter, and it silently
 * covers nothing if the pattern drifts; the point of this file is that the set
 * is known, so the set is written down.
 */
const loadings: [string, () => React.ReactNode][] = [
  ["root", RootLoading],
  ["setup", SetupLoading],
  ["(app)", AppLoading],
  ["inbox/[id]", InboxThreadLoading],
  ["starred/[id]", StarredThreadLoading],
  ["archive/[id]", ArchiveThreadLoading],
  ["spam/[id]", SpamThreadLoading],
  ["sent/[id]", SentPreviewLoading],
  ["drafts/[id]", DraftPreviewLoading],
  ["contacts", ContactsLoading],
  ["campaigns", CampaignsLoading],
  ["campaigns/[id]", CampaignLoading],
  ["lists", ListsLoading],
  ["suppressions", SuppressionsLoading],
  ["settings", SettingsLoading],
];

afterEach(cleanup);

describe("route loading states", () => {
  it.each(loadings)("%s renders placeholder content", (name, Loading) => {
    const { container } = render(<Loading />);

    const bones = container.querySelectorAll('[data-slot="skeleton"]').length;
    const status = container.querySelector('[role="status"]');

    // Either a skeleton that models the screen, or the branded splash for the
    // waits that happen before there is a screen to model.
    expect(bones > 0 || status !== null, name).toBe(true);
  });

  it("keeps the splash to the waits that happen before there is a screen", () => {
    /**
     * The reported bug, pinned.
     *
     * `(app)/loading.tsx` used to be the splash, and by the time that boundary
     * is reached the sidebar, the folder counts and the user menu are already
     * on screen — so it read as a stall, and its `min-h-dvh` centred column
     * drew as a narrow strip beside an empty page.
     *
     * Two boundaries may legitimately be a splash, and only two: `root`,
     * which is the gate deciding between the wizard, sign-in and the mailbox,
     * and `setup`, where the database this screen exists to configure may not
     * exist yet. In both cases *which* screen you are about to see is the
     * question being answered, so there is no shape to model. Everywhere else
     * the shape is known and a skeleton is owed.
     */
    const splashAllowed = new Set(["root", "setup"]);

    for (const [name, Loading] of loadings) {
      const { container, unmount } = render(<Loading />);
      const bones = container.querySelectorAll('[data-slot="skeleton"]').length;

      if (splashAllowed.has(name)) expect(bones, name).toBe(0);
      else expect(bones, name).toBeGreaterThan(0);

      unmount();
    }
  });

  it("has none where one would land in the reader slot", async () => {
    /**
     * Two separate mistakes this guards, both of which I made:
     *
     *  - A **folder-level** file for a mailbox. `loading.tsx` renders *inside*
     *    its segment's layout, so a list-column skeleton at `inbox/loading.tsx`
     *    appears beside the real list instead of in place of it. Those waits
     *    belong to the layout and are covered by a Suspense boundary there.
     *  - A file for a route that only **redirects**. `inbox/spam` and
     *    `inbox/starred` are legacy paths that `redirect()` immediately, so a
     *    skeleton there is one frame of furniture on the way past.
     */
    const { readdir } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");

    const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "(app)");
    const offenders: string[] = [];

    for (const folder of ["inbox", "sent", "drafts", "archive", "spam", "starred"]) {
      const entries: string[] = await readdir(path.join(appDir, folder)).catch(() => []);
      if (entries.includes("loading.tsx")) offenders.push(`${folder}/loading.tsx`);

      const nested: string[] = await readdir(path.join(appDir, "inbox")).catch(() => []);
      for (const child of nested) {
        const inner: string[] = await readdir(path.join(appDir, "inbox", child)).catch(() => []);
        if (child !== "[id]" && inner.includes("loading.tsx")) {
          offenders.push(`inbox/${child}/loading.tsx`);
        }
      }
    }

    expect([...new Set(offenders)]).toEqual([]);
  });
});
