import { notFound } from "next/navigation";
import { db, eq } from "@sendstack/db";
import { campaigns } from "@sendstack/db/schema";
import { CampaignActions } from "@/components/campaigns/campaign-actions";
import { HtmlMessage } from "@/components/mail/html-message";
import { DetailsPanel } from "@/components/shell/details-panel";
import { Panel, PanelBody, PanelHeader } from "@/components/shell/panel";
import { Stat, StatRow } from "@/components/shell/stat";
import { Badge } from "@/components/ui/badge";
import { Field, FieldGroup } from "@/components/ui/field";
import { formatDate } from "@/lib/utils";
import { requireAccess } from "@/lib/setup-gate";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccess();
  const { id } = await params;
  const campaign = await db.query.campaigns.findFirst({ where: eq(campaigns.id, id) });
  if (!campaign) notFound();

  // A sent, failed or cancelled campaign has nothing left to do to it, and an
  // empty bordered strip where its controls were is worse than no strip.
  const actionable = ["draft", "scheduled", "sending", "paused"].includes(campaign.status);

  return (
    <>
      <Panel className="min-w-0 flex-1 bg-card">
        <PanelHeader>
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[13px] font-medium">{campaign.name}</span>
            <Badge tone={campaign.status === "sent" ? "success" : "neutral"}>
              {campaign.status}
            </Badge>
          </div>
        </PanelHeader>

        <StatRow>
          <Stat label="Recipients" value={campaign.totalRecipients} />
          <Stat label="Sent" value={campaign.sentCount} />
          <Stat label="Opened" value={campaign.openedCount} />
          <Stat
            label="Bounced"
            value={campaign.bouncedCount}
            tone={campaign.bouncedCount > 0 ? "danger" : "default"}
          />
        </StatRow>

        {/* Its own row rather than the 48px header: the confirm step puts a
            sentence beside two buttons, which a fixed-height bar cannot hold on
            a phone without spilling sideways. */}
        {actionable ? (
          <div className="shrink-0 border-b px-4 py-2">
            <CampaignActions
              campaignId={campaign.id}
              status={campaign.status}
              recipients={campaign.totalRecipients}
            />
          </div>
        ) : null}

        <PanelBody className="bg-background/40">
          <div className="mx-auto max-w-[680px] px-5 py-4">
            <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
              <div className="border-b px-4 py-2.5">
                <p className="text-[11px] text-muted-foreground">Subject</p>
                <p className="mt-0.5 text-[13px] font-medium">{campaign.subject}</p>
              </div>
              {/* Rendered in the same isolated frame the inbox uses. The body
                  is a whole email document with its own resets and table
                  widths; injected into the page it fights the app's stylesheet
                  and shows the recipient something the operator never saw. */}
              <HtmlMessage html={campaign.html} className="rounded-none border-0" />
            </div>
          </div>
        </PanelBody>
      </Panel>

      {/*
       * Keeps the floating trigger, unlike the thread reader: there is no
       * composer here and nothing else at the bottom of the screen to attach a
       * control to, which is the situation a floating button is right for.
       */}
      <DetailsPanel>
          <FieldGroup title="Delivery">
            <Field label="Status">
              <Badge tone={campaign.status === "sent" ? "success" : "neutral"}>
                {campaign.status}
              </Badge>
            </Field>
            <Field label="Scheduled">
              {campaign.scheduledAt ? formatDate(campaign.scheduledAt) : "—"}
            </Field>
            <Field label="Started">
              {campaign.startedAt ? formatDate(campaign.startedAt) : "—"}
            </Field>
            <Field label="Completed">
              {campaign.completedAt ? formatDate(campaign.completedAt) : "—"}
            </Field>
          </FieldGroup>

          <FieldGroup title="Message">
            <Field label="From">
              {campaign.fromName} &lt;{campaign.fromEmail}&gt;
            </Field>
            <Field label="Reply-to">{campaign.replyTo ?? "—"}</Field>
          </FieldGroup>

          <FieldGroup title="Outcome">
            <Field label="Delivered">
              <span className="tabular">{campaign.deliveredCount}</span>
            </Field>
            <Field label="Clicked">
              <span className="tabular">{campaign.clickedCount}</span>
            </Field>
            <Field label="Complaints">
              <span className="tabular">{campaign.complainedCount}</span>
            </Field>
            <Field label="Suppressed">
              <span className="tabular">{campaign.suppressedCount}</span>
            </Field>
            <Field label="Failed">
              <span className="tabular">{campaign.failedCount}</span>
            </Field>
          </FieldGroup>
      </DetailsPanel>
    </>
  );
}
