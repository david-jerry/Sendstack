import { describe, expect, it, vi } from "vitest";
import type { Session } from "./server";

/**
 * The send gate's decision table, without a database.
 *
 * The write to `policy_decisions` is mocked here and proven real in
 * `apps/web/src/actions/policy-gate.integration.test.ts`. What this pins is
 * the *decision*: under the shipped policy nothing is refused, and under the
 * enforced one exactly the unverified account is. A future flip of
 * `SEND_VERIFICATION_POLICY` changes the first block's expectations and
 * nothing else — which is the point of having one value.
 */
const insert = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@sendstack/db", () => ({
  db: { insert: () => ({ values: insert }) },
  policyDecisions: {},
}));

function session(emailVerified: boolean): Session {
  return { user: { id: "u1", emailVerified } } as unknown as Session;
}

describe("assertCanSend", () => {
  it("ships unenforced, and says so in one place", async () => {
    const { SEND_VERIFICATION_POLICY } = await import("./policy");
    expect(SEND_VERIFICATION_POLICY).toBe("unenforced");
  });

  it("allows everyone under the shipped policy, verified or not", async () => {
    const { assertCanSend } = await import("./policy");
    expect(await assertCanSend(session(false), "thread.send")).toBeNull();
    expect(await assertCanSend(session(true), "campaign.send")).toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses an unverified account when enforced, and records it", async () => {
    const { assertCanSend } = await import("./policy");
    insert.mockClear();

    const refused = await assertCanSend(session(false), "compose.send", { policy: "enforced" });
    expect(refused).toMatchObject({ ok: false });
    expect(refused?.error).toMatch(/confirm your email/i);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ policy: "send.verification", surface: "compose.send", subjectUserId: "u1" }),
    );
  });

  it("allows a verified account when enforced, and records nothing", async () => {
    const { assertCanSend } = await import("./policy");
    insert.mockClear();
    expect(await assertCanSend(session(true), "campaign.schedule", { policy: "enforced" })).toBeNull();
    expect(insert).not.toHaveBeenCalled();
  });
});
