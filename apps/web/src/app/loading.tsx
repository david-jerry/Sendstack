import { Splash } from "@/components/shell/splash";

/**
 * First contact with the app, and nothing else.
 *
 * This boundary covers the root segment, which after the additions below is
 * only `/` — the gate that decides between the setup wizard, the sign-in page
 * and the mailbox. That decision needs the database, and until it answers
 * there is genuinely nothing to model with a skeleton: no list, no form, no
 * table, because which of those you are about to see is the question being
 * asked.
 *
 * Every other segment has a boundary of its own, and a nested one always
 * wins — `(auth)` draws the sign-in card, `(app)` the mailbox, `setup` the
 * wizard, and each route inside them its own shape. Without those this splash
 * leaked into all of them, telling someone the app was "starting up" while
 * they were already using it.
 */
export default function RootLoading() {
  return <Splash detail="Starting up…" />;
}
