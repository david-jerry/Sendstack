import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertTriangle, Terminal } from "lucide-react";
import { brandingRefs, getConfig, getSetupState } from "@sendstack/config";
import { Wizard, type WizardData } from "@/components/setup/wizard";
import { NO_INDEX_METADATA } from "@/lib/seo";
import type { StepId } from "@/components/setup/shell";
import { DEFAULT_BRAND_COLOR, absoluteUrl } from "@sendstack/shared";

export const dynamic = "force-dynamic";

/**
 * `robots.txt` already disallows this path, but that is a request rather than
 * a rule and it only reaches crawlers that read it. A meta tag is the half
 * that binds — and this page shows the shape of an instance's configuration.
 */
export const metadata: Metadata = NO_INDEX_METADATA;

/**
 * The wizard's entry point.
 *
 * Everything before the `<Wizard>` handles the cases where the app cannot yet
 * read its own configuration — no secret, no database, no schema. Those screens
 * deliberately touch nothing but `process.env`, because the whole point is that
 * they must render when the database this page exists to configure is
 * unreachable.
 */
export default async function SetupPage() {
  const state = await getSetupState();

  if (state.stage === "complete") redirect("/inbox");

  if (state.stage === "no-secret") {
    return (
      <Fatal
        title="Set an auth secret first"
        body="AUTH_SECRET must be at least 32 characters before Sendstack can store anything. It signs your sessions and encrypts every credential saved here, so it cannot itself be stored in the database."
        command={`AUTH_SECRET="$(openssl rand -base64 32)"`}
        // Naming the file matters: `next dev` runs inside apps/web, so it is
        // reasonable to assume a root .env is being ignored. It is not — the
        // config loads it explicitly — but only saying so stops the guessing.
        footnote="Put it in .env at the repository root, then restart the dev server."
      />
    );
  }

  if (state.stage === "needs-migration") {
    return (
      <Fatal
        title="The database needs its schema"
        body="Sendstack connected to Postgres, but the tables do not exist yet. Apply the migrations and reload this page."
        command="pnpm db:migrate"
        footnote="Run this from the repository root."
      />
    );
  }

  // From here the database is reachable, so configuration can be read.
  const needsBootstrap = state.stage === "no-database";
  const config = needsBootstrap ? null : await getConfig({ fresh: true });
  const refs = needsBootstrap ? { logo: null, favicon: null } : await brandingRefs();

  const appUrl = config?.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const base = absoluteUrl(appUrl);

  const startAt: StepId = needsBootstrap
    ? "bootstrap"
    : ((state.stage === "incomplete" ? state.step : "account") as StepId);

  const data: WizardData = {
    needsBootstrap,
    startAt,
    appName: config?.appName ?? "Sendstack",
    appUrl,
    primaryColor: config?.primaryColor ?? DEFAULT_BRAND_COLOR,
    logoUrl: refs.logo?.href ?? null,
    faviconUrl: refs.favicon?.href ?? null,
    cloudinary: {
      cloudName: config?.cloudinary.cloudName ?? "",
      folder: config?.cloudinary.folder ?? "sendstack",
      hasCredentials: Boolean(config?.cloudinary.apiKey && config?.cloudinary.apiSecret),
    },
    resendDomain: config?.resend.domain ?? "",
    resendFromEmail: config?.resend.fromEmail ?? "",
    resendFromName: config?.resend.fromName ?? "",
    hasResendKey: Boolean(config?.resend.apiKey),
    redisRestUrl: config?.redis.url ?? "",
    auth: config?.auth ?? { emailPassword: true, passkey: false, magicLink: false },
    canMagicLink: Boolean(config?.resend.apiKey),
    canPasskey: /^https:\/\//.test(base) || /localhost|127\.0\.0\.1/.test(base),
    webhookUrl: `${base}/api/webhooks/resend`,
    inngestUrl: `${base}/api/inngest`,
  };

  return <Wizard data={data} />;
}

/** For the states no amount of form-filling can fix from inside the app. */
function Fatal({
  title,
  body,
  command,
  footnote,
}: {
  title: string;
  body: string;
  command: string;
  footnote?: string;
}) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-[460px] items-center">
      <div className="w-full rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex size-8 items-center justify-center rounded-full bg-signal-warning/15">
          <AlertTriangle className="size-4 text-signal-warning" />
        </div>
        <h1 className="mt-3 text-[15px] font-medium">{title}</h1>
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{body}</p>
        <div className="mt-3 flex items-center gap-2 rounded-lg border bg-secondary/40 px-2.5 py-2">
          <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
          <code className="scroll-subtle overflow-x-auto text-[11px] whitespace-nowrap">
            {command}
          </code>
        </div>
        {footnote ? (
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{footnote}</p>
        ) : null}
      </div>
    </div>
  );
}
