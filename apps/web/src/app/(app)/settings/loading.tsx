import { SettingsSkeleton } from "@/components/shell/skeletons";

/**
 * Settings loading.
 *
 * Modelled on the tab rail rather than on a table: this screen reads the
 * config, the deliverability report and Redis before it can paint, so the
 * wait is real and worth shaping honestly.
 */
export default function Loading() {
  return <SettingsSkeleton />;
}
