import { Panel, PanelHeader } from "@/components/shell/panel";
import { Stat, StatRow } from "@/components/shell/stat";
import { CampaignsPanel } from "@/components/campaigns/campaigns-panel";
import { CreateCampaignModal } from "@/components/campaigns/create-campaign-modal";
import { campaignTotals, listCampaignPage, listLists } from "@/lib/queries/audience";
import { requireAccess } from "@/lib/setup-gate";

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAccess();
  const { q } = await searchParams;

  /**
   * Totals come from the database, not from the page.
   *
   * They used to be summed over whatever the first hundred rows happened to
   * be, which meant the headline numbers changed as soon as the list was
   * paginated or filtered — and were wrong from the hundred-and-first campaign
   * onwards regardless.
   */
  const [first, totals, lists] = await Promise.all([
    listCampaignPage({ query: q }),
    campaignTotals(),
    listLists(),
  ]);

  return (
    <Panel className="min-w-0 flex-1 bg-card">
      <PanelHeader title="Campaigns" className="justify-between">
        <CreateCampaignModal
          lists={lists.map((list) => ({
            id: list.id,
            name: list.name,
            memberCount: list.memberCount,
          }))}
        />
      </PanelHeader>

      <StatRow>
        <Stat label="Sent" value={totals.sent} />
        <Stat label="Delivered" value={totals.delivered} />
        <Stat label="Opened" value={totals.opened} />
        <Stat
          label="Bounced"
          value={totals.bounced}
          tone={totals.bounced > 0 ? "danger" : "default"}
        />
      </StatRow>

      <CampaignsPanel initialPage={first} />
    </Panel>
  );
}
