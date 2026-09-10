import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The webhook handler when the database or a handler fails.
 *
 * Two failures that each used to lose an event, for opposite reasons:
 *
 *  - The Redis claim is won and the insert throws. Resend retries, Redis says
 *    "already seen" for 24 hours, and nothing was ever written. The claim has
 *    to be handed back before answering.
 *  - The insert succeeds and a handler throws. The event row used to be
 *    committed already, so the retry was deduped by the unique index and the
 *    suppression or status update never ran at all. Both now live in one
 *    transaction, so the failure rolls the row back — and nothing may be
 *    published, because there is no longer anything to publish about.
 */
const mocks = vi.hoisted(() => ({
  claimOnce: vi.fn(async () => true),
  releaseClaim: vi.fn(async () => undefined),
  publishRealtime: vi.fn(async () => undefined),
  insertError: null as Error | null,
  executeError: null as Error | null,
  /**
   * Which `execute` to fail on, 1-based.
   *
   * Failing the *first* statement made the publish assertion vacuous: the
   * first statement in `handleDelivery` is the recipient UPDATE, so the
   * handler threw before reaching any publish site and nothing was published
   * whether publishing was deferred or inline. Failing the *third* lets the
   * recipient UPDATE and the `outbound_messages` UPDATE succeed — and it is
   * that second statement whose returned row the old code published about,
   * from inside the transaction, before this one throws.
   */
  failOnExecuteCall: 1,
  executeCalls: 0,
  committed: [] as string[],
  rolledBack: 0,
}));

vi.mock("@sendstack/redis", () => ({
  claimOnce: mocks.claimOnce,
  releaseClaim: mocks.releaseClaim,
  publishRealtime: mocks.publishRealtime,
}));

/**
 * A fake transaction that records whether it committed.
 *
 * The point under test is *atomicity*, so the mock has to model it: the insert
 * is staged, and it only counts as committed if the callback returns. A throw
 * anywhere inside discards it, which is exactly what Postgres does and what
 * the previous version of this route did not do.
 */
vi.mock("@sendstack/db", () => {
  const executor = {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (mocks.insertError) throw mocks.insertError;
            return [{ id: "evt" }];
          },
        }),
      }),
    }),
    execute: async () => {
      mocks.executeCalls += 1;
      if (mocks.executeError && mocks.executeCalls >= mocks.failOnExecuteCall) {
        throw mocks.executeError;
      }
      // A matching one-off message, so `handleDelivery` reaches its publish
      // site. The recipient UPDATE ignores its result, so one shape serves
      // both statements.
      return [{ id: "out_1", thread_key: "thread_1" }];
    },
  };

  return {
    db: {
      ...executor,
      transaction: async (fn: (tx: typeof executor) => Promise<unknown>) => {
        const staged: string[] = ["evt"];
        try {
          const result = await fn(executor);
          mocks.committed.push(...staged);
          return result;
        } catch (error) {
          mocks.rolledBack += 1;
          throw error;
        }
      },
    },
    sql: Object.assign(() => "", { join: () => "" }),
    sqlArray: () => "",
  };
});
vi.mock("@sendstack/db/schema", () => ({ emailEvents: { providerEventId: "provider_event_id" } }));
/**
 * The SQL generators are stubbed to empty strings because this suite is about
 * the Redis claim, not the statements — the database is mocked away above. Any
 * generator the route uses has to appear here, though: an explicit `vi.mock`
 * factory replaces the whole module, so a missing key is a runtime throw that
 * surfaces as a 500 and looks like the claim logic failing.
 */
vi.mock("@sendstack/jobs", () => ({
  recordInboundEmail: vi.fn(async () => null),
  announceInboundEmail: vi.fn(async () => undefined),
  recipientStatusCase: () => "",
  outboundStatusCase: () => "",
  eventAdvancesCase: () => "",
}));
vi.mock("@sendstack/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sendstack/email")>();
  return {
    ...actual,
    verifyWebhook: async (raw: string) => JSON.parse(raw),
    broadcastPush: vi.fn(),
  };
});

const { POST } = await import("./route");

function deliver(id: string, type = "email.sent", data?: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/webhooks/resend", {
      method: "POST",
      headers: { "svix-id": id, "content-type": "application/json" },
      body: JSON.stringify({
        type,
        created_at: new Date().toISOString(),
        data: data ?? { email_id: "msg_test", to: ["a@example.com"] },
      }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.insertError = null;
  mocks.executeError = null;
  mocks.failOnExecuteCall = 1;
  mocks.executeCalls = 0;
  mocks.committed = [];
  mocks.rolledBack = 0;
});

describe("webhook claim release", () => {
  it("releases the Redis claim and asks for a retry when the insert fails", async () => {
    mocks.insertError = new Error("connection terminated");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await deliver("evt_1");
    quiet.mockRestore();

    expect(response.status).toBe(500);
    expect(mocks.claimOnce).toHaveBeenCalledWith("webhook:evt_1");
    expect(mocks.releaseClaim).toHaveBeenCalledWith("webhook:evt_1");
    expect(mocks.committed).toEqual([]);
  });

  it("keeps the claim when the event is recorded", async () => {
    const response = await deliver("evt_2");
    expect(response.status).toBe(200);
    expect(mocks.releaseClaim).not.toHaveBeenCalled();
    expect(mocks.committed).toEqual(["evt"]);
  });

  it("answers without touching the database when Redis has seen the event", async () => {
    mocks.claimOnce.mockResolvedValueOnce(false);
    const response = await deliver("evt_3");
    expect(await response.json()).toEqual({ ok: true, deduped: "redis" });
    expect(mocks.committed).toEqual([]);
  });
});

describe("webhook handler failure", () => {
  it("rolls the event row back so the retry is not deduped away", async () => {
    // Before the transaction, this row committed and every retry was answered
    // "already handled" while the status update it existed for had never run.
    mocks.executeError = new Error("deadlock detected");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await deliver("evt_4", "email.bounced");
    quiet.mockRestore();

    expect(response.status).toBe(500);
    expect(mocks.rolledBack).toBe(1);
    expect(mocks.committed).toEqual([]);
    expect(mocks.releaseClaim).toHaveBeenCalledWith("webhook:evt_4");
  });

  it("publishes nothing when the transaction rolls back", async () => {
    /**
     * A realtime event about a suppression that did not happen is worse than
     * no event: the browser would fetch a row Postgres never wrote.
     *
     * The failure is aimed at the third statement, so the recipient UPDATE and
     * the `outbound_messages` UPDATE have both succeeded — and the row that
     * second one returns is exactly what the old code published about, inline,
     * before anything committed. Reverting the deferral makes this fail.
     */
    mocks.executeError = new Error("deadlock detected");
    mocks.failOnExecuteCall = 3;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await deliver("evt_5", "email.bounced");
    quiet.mockRestore();

    expect(response.status).toBe(500);
    // It got far enough to have published, had publishing been inline.
    expect(mocks.executeCalls).toBeGreaterThanOrEqual(3);
    expect(mocks.publishRealtime).not.toHaveBeenCalled();
    expect(mocks.committed).toEqual([]);
  });

  /**
   * The same guarantee for an account event, which reaches the database by a
   * different path.
   *
   * `suppression.added` is the only one of the ten that writes, and it writes
   * through `suppress()` — so it carries a realtime publish *and* a web push.
   * A push is the one effect that cannot be recalled once it has gone out,
   * which is what makes "nothing escapes a rolled-back transaction"
   * load-bearing here rather than tidy. `domain.updated` would not serve:
   * it writes nothing, so there is no statement for the failure to land on.
   *
   * **The failure is aimed at the second statement, and that is the whole
   * test.** `suppress()` runs `INSERT INTO suppressions` and then `UPDATE
   * contacts`; failing the first would throw before any publish site was
   * reached and the assertions below would hold no matter where publishing
   * happened — the vacuum the sibling test above documents. Failing the
   * second means the INSERT has already succeeded, so a publish placed
   * anywhere after it would have escaped a transaction that then rolled back.
   */
  it("neither publishes nor pushes when an account event rolls back", async () => {
    const { broadcastPush } = await import("@sendstack/email");
    mocks.executeError = new Error("deadlock detected");
    mocks.failOnExecuteCall = 2;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await deliver("evt_6", "suppression.added", {
      email: "them@example.test",
      origin: "bounce",
    });
    quiet.mockRestore();

    expect(response.status).toBe(500);
    expect(mocks.rolledBack).toBe(1);
    expect(mocks.committed).toEqual([]);
    expect(mocks.releaseClaim).toHaveBeenCalledWith("webhook:evt_6");
    // The suppression row was written before the failure, so this is not
    // vacuous: there was something to wrongly announce.
    expect(mocks.executeCalls).toBeGreaterThanOrEqual(2);
    expect(mocks.publishRealtime).not.toHaveBeenCalled();
    expect(vi.mocked(broadcastPush)).not.toHaveBeenCalled();
  });
});
