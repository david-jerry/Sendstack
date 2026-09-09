import Link from "next/link";
import { AlertTriangle, Check, CircleAlert } from "lucide-react";
import type { DeliverabilityReport } from "@sendstack/config";
import { cn, plural } from "@/lib/utils";

/**
 * Whether this instance is configured to reach an inbox.
 *
 * Every check here corresponds to something a mailbox provider measures, and
 * every failure is invisible at send time: Resend accepts the message, the API
 * returns 200, and the mail goes to spam with nothing anywhere reporting it.
 * A screen is the only place they can be seen.
 *
 * Read-only on purpose. Each row names the setting that fixes it rather than
 * offering a control, because several of them are fixed in DNS or in Resend
 * rather than here, and a button that cannot actually resolve the problem is
 * worse than a sentence that says where to go.
 */
export function DeliverabilitySection({ report }: { report: DeliverabilityReport }) {
  const failing = report.blocking.length + report.warnings.length;

  return (
    <div className="space-y-3">
      {failing === 0 ? (
        <p className="flex items-center gap-2 rounded-lg border border-signal-success/40 bg-signal-success/8 px-3 py-2.5 text-[12px] text-signal-success">
          <Check className="size-3.5 shrink-0" />
          Everything Sendstack can check from here is in order.
        </p>
      ) : (
        <p
          className={cn(
            "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[12px]",
            report.blocking.length > 0
              ? "border-destructive/40 bg-destructive/8 text-destructive"
              : "border-signal-warning/40 bg-signal-warning/8 text-signal-warning",
          )}
        >
          {report.blocking.length > 0 ? (
            <CircleAlert className="mt-px size-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
          )}
          <span>
            {report.blocking.length > 0
              ? `Campaigns cannot be sent until ${
                  report.blocking.length === 1
                    ? "this is fixed"
                    : `these ${report.blocking.length} are fixed`
                }. Sending anyway would cost your domain's reputation rather than reach anyone.`
              : `${failing} ${plural(failing, "thing")} worth fixing. Campaigns will send, but placement will suffer.`}{" "}
            {/* Most of these are fixed two tabs away. Naming the tab without
                linking to it is a sentence that makes the reader do the work. */}
            <Link href="/settings?tab=workspace" className="underline underline-offset-2">
              Workspace
            </Link>{" "}
            and{" "}
            <Link href="/settings?tab=email" className="underline underline-offset-2">
              Email
            </Link>{" "}
            hold the settings named below.
          </span>
        </p>
      )}

      <ul className="divide-y rounded-lg border">
        {report.checks.map((check) => (
          <li key={check.id} className="flex items-start gap-2.5 px-3 py-2.5">
            <span className="mt-px shrink-0">
              {check.passed ? (
                <Check className="size-3.5 text-signal-success" />
              ) : check.severity === "blocking" ? (
                <CircleAlert className="size-3.5 text-destructive" />
              ) : (
                <AlertTriangle className="size-3.5 text-signal-warning" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-[12px] font-medium",
                  check.passed && "text-muted-foreground",
                )}
              >
                {check.title}
              </p>
              {check.detail ? (
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {check.detail}
                </p>
              ) : null}
            </div>
            {check.passed ? null : (
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                  check.severity === "blocking"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-signal-warning/10 text-signal-warning",
                )}
              >
                {check.severity === "blocking" ? "Blocking" : "Warning"}
              </span>
            )}
          </li>
        ))}
      </ul>

      {/* The two things Sendstack cannot see from inside the process. DKIM and
          SPF are Resend's to verify; DMARC is a record only the domain owner
          can publish, and Gmail and Yahoo both require one from bulk senders. */}
      <div className="rounded-lg border bg-secondary/40 p-3">
        <p className="text-[11px] font-medium">Checked outside Sendstack</p>
        <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">SPF and DKIM</span> — verify the sending
            domain in Resend until every record shows green.
          </li>
          <li>
            <span className="font-medium text-foreground">DMARC</span> — publish a{" "}
            <code className="rounded bg-card px-1">_dmarc</code> TXT record. Gmail and Yahoo both
            require one from bulk senders; add <code className="rounded bg-card px-1">rua=</code> so
            you can see what is failing.
          </li>
          <li>
            <span className="font-medium text-foreground">Warm-up</span> — a new domain has no
            reputation. Send tens of messages a day to people who opened them before raising the
            send rate.
          </li>
        </ul>
      </div>
    </div>
  );
}
