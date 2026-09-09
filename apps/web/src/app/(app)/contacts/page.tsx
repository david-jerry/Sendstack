import { Panel, PanelHeader } from "@/components/shell/panel";
import { Stat, StatRow } from "@/components/shell/stat";
import { AddContactModal } from "@/components/contacts/add-contact-modal";
import { ContactsPanel } from "@/components/contacts/contacts-panel";
import {
  contactStats,
  listContactGroups,
  listContactPage,
  listLists,
} from "@/lib/queries/audience";
import { requireAccess } from "@/lib/setup-gate";
import { formatCount } from "@/lib/utils";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAccess();
  const { q } = await searchParams;

  /**
   * The first page is rendered on the server with the same term the client
   * will fetch with, so a shared link or a reload shows the results rather
   * than the whole audience flashing past first.
   */
  const [first, stats, groups, lists] = await Promise.all([
    listContactPage({ query: q }),
    contactStats(),
    listContactGroups(),
    listLists(),
  ]);

  return (
    <Panel className="min-w-0 flex-1 bg-card">
      <PanelHeader title="Contacts" className="justify-between">
        <AddContactModal
          initialLists={lists.map((list) => ({
            id: list.id,
            name: list.name,
            memberCount: list.memberCount,
          }))}
          initialGroups={groups.map((group) => ({
            id: group.id,
            name: group.name,
            memberCount: group.memberCount,
          }))}
        />
      </PanelHeader>

      <StatRow>
        {/* Capped counts, rendered "20k+" past the cap — the same treatment
            the sidebar badges get. Counting every contact on every load of
            this page was an unbounded scan for three numbers. */}
        <Stat label="Total" value={formatCount(stats.total.value, stats.total.capped)} />
        <Stat
          label="Active"
          value={formatCount(stats.active.value, stats.active.capped)}
          tone="success"
        />
        <Stat
          label="Suppressed"
          value={formatCount(stats.suppressed.value, stats.suppressed.capped)}
          tone={stats.suppressed.value > 0 ? "danger" : "default"}
        />
      </StatRow>

      <ContactsPanel initialPage={first} />
    </Panel>
  );
}
