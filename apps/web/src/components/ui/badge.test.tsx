import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Badge } from "./badge";

/**
 * The two variant axes, and the rule that keeps them apart.
 *
 * This component carries shadcn's canonical `variant` and this app's own
 * `tone` at the same time. Nineteen call sites across the inbox, campaigns,
 * suppressions and the outbound list pass `tone`; the marketing page passes
 * `variant`. Both have to keep working, and neither may leak into the other —
 * a badge with two backgrounds lets CSS specificity decide what it looks like.
 */

afterEach(cleanup);

const badge = () => screen.getByText("Label");

describe("tone — the semantic axis", () => {
  it("defaults to neutral, as every existing call site expects", () => {
    render(<Badge>Label</Badge>);
    expect(badge()).toHaveAttribute("data-tone", "neutral");
    expect(badge().className).toContain("bg-secondary");
  });

  it("maps each tone to its signal token", () => {
    // These are the distinction the app is built on: a bounce is `danger`, a
    // delayed send is `warning`, and shadcn's `destructive`/`secondary` cannot
    // express the difference.
    const cases = [
      ["success", "text-signal-success"],
      ["warning", "text-signal-warning"],
      ["info", "text-signal-info"],
      ["danger", "text-destructive"],
    ] as const;

    for (const [tone, expected] of cases) {
      cleanup();
      render(<Badge tone={tone}>Label</Badge>);
      expect(badge().className, tone).toContain(expected);
    }
  });
});

describe("variant — the canonical axis", () => {
  it("applies the shadcn classes", () => {
    render(<Badge variant="outline">Label</Badge>);
    expect(badge()).toHaveAttribute("data-variant", "outline");
    expect(badge().className).toContain("border-border");
  });

  it("suppresses the tone default rather than layering both", () => {
    /**
     * The rule this file exists for. `defaultVariants: { tone: "neutral" }` in
     * cva would paint a secondary background behind every outline badge,
     * because cva cannot express "default this one only when that one is
     * absent" — so the resolution happens in the component.
     */
    render(<Badge variant="outline">Label</Badge>);
    expect(badge().className).not.toContain("bg-secondary");
    expect(badge()).not.toHaveAttribute("data-tone");
  });

  it("wins when both are passed", () => {
    // An explicit variant is a deliberate choice of weight; falling back to a
    // tone underneath it would give the badge two backgrounds.
    render(
      <Badge
        variant="outline"
        tone="danger"
      >
        Label
      </Badge>,
    );
    expect(badge().className).not.toContain("bg-destructive/10");
    expect(badge().className).toContain("border-border");
  });
});

describe("the canonical behaviours", () => {
  it("carries data-slot, which shadcn's styles and tests key off", () => {
    render(<Badge>Label</Badge>);
    expect(badge()).toHaveAttribute("data-slot", "badge");
  });

  it("renders as its child with asChild", () => {
    // The Slot behaviour from the registry component — a badge that is also a
    // link has to be one element, not a span wrapping an anchor.
    // An external href, so the Next lint rule that wants `<Link>` for internal
    // routes does not fire on a test that is about Slot, not about routing.
    render(
      <Badge asChild>
        <a href="https://example.com">Label</a>
      </Badge>,
    );
    const link = screen.getByRole("link", { name: "Label" });
    expect(link).toHaveAttribute("data-slot", "badge");
  });

  it("keeps a caller's className last, so it can override", () => {
    render(<Badge className="rounded-none">Label</Badge>);
    expect(badge().className).toContain("rounded-none");
  });
});
