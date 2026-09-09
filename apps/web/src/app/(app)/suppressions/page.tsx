import { Panel, PanelBody, PanelHeader } from "@/components/shell/panel";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Table, Td, Th, Tr } from "@/components/ui/table";
import { listSuppressions } from "@/lib/queries/audience";
import { formatDate } from "@/lib/utils";
import { requireAccess } from "@/lib/setup-gate";

const REASON_TONE: Record<string, "danger" | "warning" | "neutral"> = {
  hard_bounce: "danger",
  complaint: "danger",
  soft_bounce_limit: "warning",
  invalid_address: "warning",
  unsubscribe: "neutral",
  manual: "neutral",
};

const REASON_LABEL: Record<string, string> = {
  hard_bounce: "Hard bounce",
  complaint: "Spam complaint",
  soft_bounce_limit: "Repeated soft bounces",
  invalid_address: "Invalid address",
  unsubscribe: "Unsubscribed",
  manual: "Added manually",
};

export default async function SuppressionsPage() {
  await requireAccess();
  const suppressions = await listSuppressions();

  return (
    <Panel className="min-w-0 flex-1 bg-card">
      <PanelHeader title="Suppressions" />

      <div className="border-b bg-secondary/40 px-4 py-2.5">
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Nothing is ever sent to an address on this list. Bounces and spam complaints are added
          automatically and cannot be removed — the receiving server rejected the address, and
          retrying it damages your sending domain&apos;s reputation.
        </p>
      </div>

      <PanelBody>
        {suppressions.length === 0 ? (
          <EmptyState
            title="Nothing suppressed"
            description="Hard bounces and spam complaints land here automatically as Resend reports them. You can also add an address by hand."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Address</Th>
                <Th>Reason</Th>
                <Th>Detail</Th>
                <Th className="text-right">Added</Th>
              </tr>
            </thead>
            <tbody>
              {suppressions.map((suppression) => (
                <Tr key={suppression.id}>
                  <Td className="font-medium">{suppression.email}</Td>
                  <Td>
                    <Badge tone={REASON_TONE[suppression.reason] ?? "neutral"}>
                      {REASON_LABEL[suppression.reason] ?? suppression.reason}
                    </Badge>
                  </Td>
                  <Td className="max-w-[320px] truncate text-muted-foreground">
                    {suppression.detail ?? "—"}
                  </Td>
                  <Td className="tabular text-right text-muted-foreground">
                    {formatDate(suppression.createdAt)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </PanelBody>
    </Panel>
  );
}
