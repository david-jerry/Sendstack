import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { DateText, NumberText, RelativeTime } from "./time";
import { formatDate, formatNumber } from "@/lib/utils";

/**
 * A real hydration test, not an approximation.
 *
 * `renderToString` produces the HTML a server would send, then `hydrateRoot`
 * hydrates that exact markup — which is the only way to catch the class of bug
 * these components exist for. Testing Library's `render` cannot: it mounts
 * fresh on the client, where there is no server output to disagree with.
 *
 * Mismatches are collected through `onRecoverableError` rather than by spying
 * on `console.error`. It is the documented hook for this, it is deterministic,
 * and — the practical reason — React re-throws an unhandled mismatch, which
 * vitest reports as a suite-level error beside an otherwise passing test.
 * Handling it here keeps a deliberate mismatch a *result* rather than noise.
 */

/**
 * Testing Library sets this for its own `render`; `hydrateRoot` is called
 * directly here, so React has to be told the same thing or every `act` logs
 * "the current testing environment is not configured to support act(...)".
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const INSTANT = "2026-09-05T21:30:00.000Z";

afterEach(() => {
  document.body.innerHTML = "";
});

/**
 * Server-render, hydrate that exact markup, and report all three outcomes.
 *
 * `server` and `hydrated` differ by design for these components: the first is
 * a fixed en-US/UTC rendering and the second is the reader's own.
 *
 * @param element Rendered twice — once as the server would, once as the client.
 * @returns The server HTML, the HTML after hydration, and every mismatch React
 *   recovered from. An empty `complaints` array is the assertion that matters.
 */
async function hydrate(element: React.ReactElement) {
  const html = renderToString(element);
  const complaints: string[] = [];

  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);

  await act(async () => {
    hydrateRoot(container, element, {
      onRecoverableError: (error) => {
        complaints.push(error instanceof Error ? error.message : String(error));
      },
    });
  });

  return { server: html, hydrated: container.innerHTML, complaints };
}

describe("DateText", () => {
  it("hydrates without a mismatch", async () => {
    /**
     * The bug this closes. `formatDate` uses
     * `toLocaleDateString(undefined, …)`, which takes the *runtime's* locale:
     * `"Sep 5"` on a Vercel server in `en-US`/UTC, `"5 Sept"` in a British
     * browser. Every list row with a date in it was a guaranteed mismatch for
     * any reader outside the server's locale.
     */
    const { complaints } = await hydrate(<DateText value={INSTANT} />);
    expect(complaints).toEqual([]);
  });

  it("sends a fixed en-US, UTC form from the server", async () => {
    // Fixed on purpose: a locale and zone named explicitly produce the same
    // string on any machine in any region, which is what lets the hydration
    // render agree with it.
    const { server } = await hydrate(<DateText value={INSTANT} />);
    expect(server).toContain("Sep 5");
  });

  it("shows the reader's own format once hydrated", async () => {
    const { hydrated } = await hydrate(<DateText value={INSTANT} />);
    expect(hydrated).toContain(formatDate(INSTANT));
  });

  it("carries the full instant for machines and screen readers", async () => {
    // "Sep 5" is ambiguous about the year and says nothing about the time;
    // `dateTime` is the unambiguous version, and it is UTC so it cannot drift.
    const { server } = await hydrate(<DateText value={INSTANT} />);
    // Case-insensitive: React 19's string renderer emits the JSX spelling,
    // and HTML attribute names are case-insensitive to the parser.
    expect(server.toLowerCase()).toContain(`datetime="${INSTANT.toLowerCase()}"`);
  });

  it("accepts a Date, a string or epoch millis", async () => {
    // The three shapes the queries return.
    for (const value of [new Date(INSTANT), INSTANT, Date.parse(INSTANT)]) {
      const { server } = await hydrate(<DateText value={value} />);
      expect(server, String(value)).toContain("Sep 5");
    }
  });
});

describe("RelativeTime", () => {
  it("hydrates without a mismatch", async () => {
    /**
     * Two things differ here, not one: the locale, and `Date.now()`. A message
     * sent 59 seconds before the server render is "now" in the HTML and "1m"
     * by the time hydration runs.
     */
    const { complaints } = await hydrate(<RelativeTime value={new Date(Date.now() - 59_000)} />);
    expect(complaints).toEqual([]);
  });

  it("sends the absolute date, then switches to the relative form", async () => {
    // The server has no clock the reader can see, so presenting its "now" as
    // current would be inventing a fact.
    const recent = new Date(Date.now() - 5 * 60_000);
    const { server, hydrated } = await hydrate(<RelativeTime value={recent} />);

    expect(server).toContain("Sep");
    expect(hydrated).toContain("5m");
  });

  it("offers the exact time on hover once hydrated", async () => {
    // "6d" is not enough to act on when looking for a specific message.
    const { hydrated } = await hydrate(<RelativeTime value={INSTANT} />);
    expect(hydrated).toContain("title=");
  });
});

describe("NumberText", () => {
  it("hydrates without a mismatch", async () => {
    /**
     * Easier to miss than the dates, because `20,481` and `20.481` differ by
     * one character — and a German reader hydrating a server-rendered
     * `20,481` gets a warning and a number that reads as twenty-point-four.
     */
    const { complaints } = await hydrate(<NumberText value={20481} />);
    expect(complaints).toEqual([]);
  });

  it("groups digits the reader's way once hydrated", async () => {
    const { server, hydrated } = await hydrate(<NumberText value={20481} />);
    expect(server).toContain("20,481");
    expect(hydrated).toContain(formatNumber(20481));
  });
});

describe("the bug these replace", () => {
  it("catches a mismatch when one is present", async () => {
    /**
     * Proof that the harness above can fail.
     *
     * Without it, "hydrates without a mismatch" would pass for a component
     * that never rendered anything — which is the failure mode of every test
     * that asserts an absence.
     */
    /**
     * `typeof window` is the obvious way to fake this and does not work: in a
     * jsdom test `window` exists during `renderToString` too, so the first
     * attempt at this test rendered identically on both sides and passed
     * while proving nothing. A module-scope flag flipped between the two
     * phases is the only reliable way to make them genuinely disagree.
     */
    let phase = "server";
    function Mismatched() {
      return <span>{phase === "server" ? "Sep 5" : "5 Sept"}</span>;
    }

    const html = renderToString(<Mismatched />);
    phase = "client";

    const complaints: string[] = [];
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);

    await act(async () => {
      hydrateRoot(container, <Mismatched />, {
        onRecoverableError: (error) => {
          complaints.push(error instanceof Error ? error.message : String(error));
        },
      });
    });

    expect(complaints.join(" ")).toMatch(/hydrat/i);
  });
});
