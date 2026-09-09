import "server-only";
import { getConfig } from "./config";

/**
 * The configuration checks that decide whether mail reaches an inbox.
 *
 * These are not style preferences. Each one corresponds to something a mailbox
 * provider measures, and every failure here is invisible at send time —
 * Resend accepts the message, the API returns a 200, and the mail quietly goes
 * to spam. The point of this module is to make that failure loud *before* a
 * campaign goes out rather than after ten thousand people never see it.
 *
 * Deliberately a pure function of stored configuration: no DNS lookups, no
 * calls to Resend. Those are worth doing too, but they are slow, they fail for
 * reasons unrelated to the answer, and they cannot run inside the send path.
 */

export type CheckSeverity =
  /** Mail will be filtered, or the campaign is unsafe to send. Blocks sending. */
  | "blocking"
  /** Measurably hurts placement, but sending is still reasonable. */
  | "warning";

export type DeliverabilityCheck = {
  id: string;
  title: string;
  severity: CheckSeverity;
  /** True when the configuration satisfies this check. */
  passed: boolean;
  /** What is wrong and what to do about it. Absent when `passed`. */
  detail?: string;
};

export type DeliverabilityReport = {
  checks: DeliverabilityCheck[];
  /** Failures that make a bulk send actively damaging. */
  blocking: DeliverabilityCheck[];
  warnings: DeliverabilityCheck[];
  /** True when nothing blocking is outstanding. */
  canSendCampaigns: boolean;
};

/** Hosts that are never reachable from a recipient's mail client. */
function isLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  );
}

/** `mail.example.com` and `example.com` are the same organisation; `vercel.app` is not. */
function sharesRegistrableDomain(a: string, b: string): boolean {
  if (a === b) return true;
  return a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/**
 * Every check, the passing ones included, already sorted by consequence.
 *
 * The severity split is computed here rather than by each caller so that the
 * Settings page and `assertCampaignDeliverability` cannot come to different
 * conclusions about what stops a send: `canSendCampaigns` is exactly "nothing
 * blocking is outstanding" and it ignores warnings entirely, which is why a
 * warning can be added without silently blocking every campaign on every
 * instance that has not fixed it yet.
 *
 * Passing checks are returned too, because the page is a checklist — it has to
 * show what is right as well as what is not.
 *
 * One `getConfig()` and no I/O beyond it, which is what lets the campaign
 * launch path call it inline.
 */
export async function deliverabilityReport(): Promise<DeliverabilityReport> {
  const config = await getConfig();
  const checks: DeliverabilityCheck[] = [];

  let appHost: string | null = null;
  let appProtocol: string | null = null;
  try {
    const parsed = new URL(config.appUrl);
    appHost = parsed.hostname;
    appProtocol = parsed.protocol;
  } catch {
    // Left null; the first check reports it.
  }

  /**
   * The one that silently ruins campaigns.
   *
   * Every unsubscribe link and every `List-Unsubscribe` header is built from
   * this URL. RFC 8058 requires the one-click URI to be HTTPS, and Gmail and
   * Yahoo both require a working one-click unsubscribe from bulk senders — so
   * an http:// or localhost value means the unsubscribe button is not shown at
   * all, and the visible link in the footer is dead. Recipients who want out
   * then press "report spam", which is the single most expensive thing that
   * can happen to a sending domain.
   */
  const appUrlUsable =
    appHost !== null && appProtocol === "https:" && !isLocalHost(appHost);
  checks.push({
    id: "app-url",
    title: "Public HTTPS address",
    severity: "blocking",
    passed: appUrlUsable,
    ...(appUrlUsable
      ? {}
      : {
          detail:
            appHost === null
              ? `"${config.appUrl}" is not a valid URL. Set the app URL in Settings → Branding.`
              : isLocalHost(appHost)
                ? `The app URL is ${config.appUrl}. Unsubscribe links are built from it, so every ` +
                  `recipient would get a link to a host that does not exist. Set it to the public ` +
                  `HTTPS address this instance is served from.`
                : `The app URL is ${config.appUrl}. RFC 8058 one-click unsubscribe requires HTTPS, ` +
                  `so mailbox providers will not show an unsubscribe button. Use https://.`,
        }),
  });

  const domain = config.resend.domain;
  checks.push({
    id: "sending-domain",
    title: "Verified sending domain",
    severity: "blocking",
    passed: Boolean(domain),
    ...(domain
      ? {}
      : {
          detail:
            "No sending domain is configured. Add and verify one in Resend, then set it in " +
            "Settings → Email so SPF and DKIM sign your mail.",
        }),
  });

  /**
   * Links that point somewhere unrelated to the From domain get judged on that
   * other domain's reputation — which, for a fresh app host, is none.
   */
  const linksAligned =
    !domain || !appHost || isLocalHost(appHost)
      ? false
      : sharesRegistrableDomain(appHost, domain);
  checks.push({
    id: "link-alignment",
    title: "Links on the sending domain",
    severity: "warning",
    passed: linksAligned,
    ...(linksAligned
      ? {}
      : {
          detail:
            domain && appHost
              ? `Mail is sent from ${domain} but its links point at ${appHost}. Filters score link ` +
                `domains separately, so serve this instance from a subdomain of ${domain} — ` +
                `mail.${domain}, say — to let both build one reputation.`
              : "Set both a sending domain and a public app URL, then serve the app from a " +
                "subdomain of the sending domain.",
        }),
  });

  const fromEmail = config.resend.fromEmail;
  const fromAligned = Boolean(fromEmail && domain && fromEmail.endsWith(`@${domain}`));
  checks.push({
    id: "from-address",
    title: "From address on the sending domain",
    severity: "blocking",
    passed: fromAligned,
    ...(fromAligned
      ? {}
      : {
          detail: fromEmail
            ? `${fromEmail} is not on ${domain ?? "the sending domain"}, so DKIM will not align ` +
              `and DMARC will fail.`
            : "No from-address is set. Add one on the sending domain in Settings → Email.",
        }),
  });

  /**
   * A display name unrelated to the domain reads as a phishing heuristic, and
   * "noreply" tells a recipient not to engage — the opposite of the signal a
   * new domain needs.
   */
  const fromName = config.resend.fromName.trim();
  const noReply = /^(no-?reply|do-?not-?reply)$/i.test(fromEmail?.split("@")[0] ?? "");
  const nameUseful = fromName.length > 0 && !noReply;
  checks.push({
    id: "from-name",
    title: "Recognisable sender",
    severity: "warning",
    passed: nameUseful,
    ...(nameUseful
      ? {}
      : {
          detail: noReply
            ? `Sending from ${fromEmail} discourages replies, and engagement is most of what a ` +
              `new domain's reputation is built from. Use an address a person can answer.`
            : "Set a from-name recipients will recognise — usually your organisation's name, " +
              "not the software's.",
        }),
  });

  const postal = config.postalAddress?.trim();
  checks.push({
    id: "postal-address",
    title: "Physical postal address",
    severity: "warning",
    passed: Boolean(postal),
    ...(postal
      ? {}
      : {
          detail:
            "CAN-SPAM requires a valid physical address on commercial mail, and filters treat " +
            "its absence as a signal. Add one under Email; it appears in campaign footers.",
        }),
  });

  /**
   * A stored signing secret is not the same as a working webhook.
   *
   * Resend has to be able to reach the endpoint, and it is reached over the
   * same app URL as everything else — so a secret sitting next to a localhost
   * address is a webhook that can never fire. Reporting that as configured is
   * how an instance ends up mailing bounced addresses for a month while the
   * settings screen shows a green tick.
   */
  const webhookConfigured = Boolean(config.resend.webhookSecret) && appUrlUsable;
  checks.push({
    id: "webhook",
    title: "Bounce and complaint webhook",
    severity: "warning",
    passed: webhookConfigured,
    ...(webhookConfigured
      ? {}
      : {
          detail:
            (config.resend.webhookSecret
              ? `A signing secret is stored, but Resend cannot deliver to ${
                  config.appUrl
                } — so no event has ever arrived. `
              : "No Resend webhook is configured. ") +
            "Without it, bounces and spam complaints never reach Sendstack and dead addresses " +
            "are never suppressed. Continuing to mail them is one of the fastest ways to get " +
            "filtered.",
        }),
  });

  const blocking = checks.filter((check) => !check.passed && check.severity === "blocking");
  const warnings = checks.filter((check) => !check.passed && check.severity === "warning");

  return { checks, blocking, warnings, canSendCampaigns: blocking.length === 0 };
}

/**
 * Throws unless a campaign can be sent without damaging the sending domain.
 *
 * Called from the action that launches a campaign rather than from the send
 * job: by the time the job runs the operator has moved on, and an error there
 * is a row in a dashboard nobody is looking at. At launch it is a message on
 * the button they just pressed.
 */
export async function assertCampaignDeliverability(): Promise<void> {
  const report = await deliverabilityReport();
  if (report.canSendCampaigns) return;

  const problems = report.blocking.map((check) => `${check.title}: ${check.detail}`).join(" ");
  throw new Error(
    `This campaign was not sent, because it would have damaged ${
      (await getConfig()).resend.domain ?? "your sending domain"
    }'s reputation rather than reaching anyone. ${problems}`,
  );
}
