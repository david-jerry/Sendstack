import { Splash } from "@/components/shell/splash";

/**
 * The wizard's own wait.
 *
 * The one place where the database genuinely may not exist yet, so the check
 * behind this screen can take a moment and can legitimately fail. A splash
 * that says what it is doing is what stops that looking like a crash.
 */
export default function SetupLoading() {
  return <Splash detail="Checking this instance…" />;
}
