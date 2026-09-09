import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

/**
 * Every time a policy gate said no, and why.
 *
 * The Identity context has one gate for send-capable actions, `assertCanSend`
 * in `@sendstack/auth`. Its answer today is always yes — verification is
 * deliberately unenforced, see `SEND_VERIFICATION_POLICY` — but the gate
 * exists so that the day the policy changes, enforcement is one line and not
 * a hunt through four action files. This table is what makes a refusal
 * something an operator can look up rather than something a user reports.
 *
 * **Refusals only.** An allow is every single send, and recording each one is
 * an unbounded write on the hottest path in the product to answer a question
 * nobody asks. The rows here are the exceptions, and they are what an operator
 * needs when someone says "it would not let me send".
 *
 * Append-only by design. A gate that refuses twice for a double-click writes
 * two rows, and that is correct: each is a distinct decision at a distinct
 * moment. Idempotency (CLAUDE.md §7) is about writes that must *not* repeat; a
 * log of decisions is one that must.
 */
export const policyDecisions = pgTable(
  "policy_decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Which rule refused: `send.verification` today. Namespaced for the next one. */
    policy: text("policy").notNull(),
    /** Where the user was: `compose.send`, `thread.send`, `campaign.send`, `campaign.schedule`. */
    surface: text("surface").notNull(),
    /**
     * `SET NULL` rather than cascade: the decision is a fact about the
     * instance's history, not about the account, and deleting an account must
     * not erase the record that it was refused.
     */
    subjectUserId: text("subject_user_id").references(() => user.id, { onDelete: "set null" }),
    /** The message the user was shown, verbatim, so support sees what they saw. */
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("policy_decisions_created_idx").on(t.createdAt),
    index("policy_decisions_subject_idx").on(t.subjectUserId),
  ],
);
