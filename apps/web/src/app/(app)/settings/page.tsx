import { brandingRefs, deliverabilityReport, getConfig, isSecureOrigin } from "@sendstack/config";
import { ThemeSelect } from "@sendstack/theme";
import { redisTransport } from "@sendstack/redis";
import { Panel, PanelHeader } from "@/components/shell/panel";
import { BrandingSection } from "@/components/settings/branding-section";
import { DeliverabilitySection } from "@/components/settings/deliverability-section";
import { NotificationsSection } from "@/components/settings/notifications-section";
import {
  AuthSection,
  EmailSection,
  JobsSection,
  RealtimeSection,
} from "@/components/settings/sections";
import {
  SettingsPanel,
  SettingsTabs,
  type SettingsTab,
} from "@/components/settings/settings-tabs";
import { resolveSettingsTab } from "@/lib/settings-tabs";
import { CustomTemplatesSection } from "@/components/settings/custom-templates-section";
import { TemplatePicker } from "@/components/settings/template-picker";
import { listCustomTemplates } from "@/lib/queries/templates";
import { requireAccess } from "@/lib/setup-gate";
import { absoluteUrl } from "@sendstack/shared";

export const dynamic = "force-dynamic";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b px-4 py-6 last:border-b-0 lg:px-6">
      <div className="mb-4">
        <h2 className="text-[13px] font-medium">{title}</h2>
        <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAccess();
  const [config, refs, transport, deliverability, customTemplates, params] = await Promise.all([
    getConfig({ fresh: true }),
    brandingRefs(),
    redisTransport().catch(() => null),
    deliverabilityReport(),
    listCustomTemplates(),
    searchParams,
  ]);

  const active = resolveSettingsTab(params.tab);
  const base = absoluteUrl(config.appUrl);
  const secureOrigin = isSecureOrigin(base);
  const outstanding = deliverability.blocking.length + deliverability.warnings.length;

  const tabs: SettingsTab[] = [
    { id: "workspace", label: "Workspace", hint: "Name, logo, colour and theme" },
    { id: "email", label: "Email", hint: "Resend, sender and templates" },
    {
      id: "deliverability",
      label: "Deliverability",
      hint: "Whether campaigns reach an inbox",
      // The one tab worth interrupting someone about: every failure behind it
      // is silent, so a count is the only way it gets looked at.
      ...(outstanding > 0 ? { badge: outstanding } : {}),
    },
    { id: "notifications", label: "Notifications", hint: "Push alerts on your devices" },
    { id: "sign-in", label: "Sign-in", hint: "Which methods people can use" },
    { id: "infrastructure", label: "Infrastructure", hint: "Redis, jobs and environment" },
  ];

  return (
    <Panel className="min-w-0 flex-1 bg-card">
      <PanelHeader title="Settings" />

      {/*
        * Keyed on the resolved tab so a link *to* a tab actually lands on it.
        * `SettingsTabs` seeds its state from `initial` once, which is what
        * lets an in-page click switch panels without a server round trip —
        * but it also means a later `initial` would be ignored. A navigation
        * changes this key and remounts; `replaceState` does not re-run this
        * component at all, so clicking between tabs never remounts.
        */}
      <SettingsTabs key={active} tabs={tabs} initial={active}>
        <SettingsPanel value="workspace">
          <Section
            title="Branding"
            description="Your name, logo and colour — used in the app header and at the top of every campaign. Images go to Cloudinary when configured, and to your database otherwise."
          >
            <BrandingSection
              initial={{
                appName: config.appName,
                appUrl: config.appUrl,
                primaryColor: config.primaryColor,
                logoUrl: refs.logo?.href ?? null,
                faviconUrl: refs.favicon?.href ?? null,
                cloudinary: {
                  cloudName: config.cloudinary.cloudName ?? "",
                  folder: config.cloudinary.folder,
                  hasCredentials: Boolean(
                    config.cloudinary.apiKey && config.cloudinary.apiSecret,
                  ),
                },
              }}
            />
          </Section>

          <Section
            title="Appearance"
            description="Light or dark. Stored in this browser only — it is a per-person preference, not an instance setting, so it does not follow you to another device or affect anyone else."
          >
            <ThemeSelect />
          </Section>
        </SettingsPanel>

        <SettingsPanel value="email">
          <Section
            title="Email"
            description="Resend sends your campaigns and receives the replies."
          >
            <EmailSection
              initial={{
                domain: config.resend.domain ?? "",
                fromEmail: config.resend.fromEmail ?? "",
                fromName: config.resend.fromName,
                postalAddress: config.postalAddress ?? "",
                ratePerSecond: config.resend.ratePerSecond,
                hasKey: Boolean(config.resend.apiKey),
                hasWebhookSecret: Boolean(config.resend.webhookSecret),
              }}
              provenance={config.provenance}
              webhookUrl={`${base}/api/webhooks/resend`}
            />
          </Section>

          <Section
            title="Default email template"
            description="The chrome wrapped around a campaign that does not choose its own. Your logo and brand colour flow into whichever you pick."
          >
            <TemplatePicker current={config.emailTemplate} />
          </Section>

          <Section
            title="Your templates"
            description="HTML templates of your own, alongside the four built in. Anyone can write one — or have one written — against the contract below, and it appears in the Design picker when composing a message or creating a campaign."
          >
            <CustomTemplatesSection templates={customTemplates} />
          </Section>
        </SettingsPanel>

        <SettingsPanel value="deliverability">
          <Section
            title="Deliverability"
            description="Whether a campaign sent from here would reach an inbox. These failures are silent otherwise — Resend accepts the message, the API returns success, and the mail goes to spam."
          >
            <DeliverabilitySection report={deliverability} />
          </Section>
        </SettingsPanel>

        <SettingsPanel value="notifications">
          <Section
            title="Push notifications"
            description="Mail arriving while the app is closed. Needs a public HTTPS origin — a service worker cannot run on a plain-HTTP address, which is why a tunnel is part of `pnpm dev`."
          >
            <NotificationsSection appName={config.appName} />
          </Section>
        </SettingsPanel>

        <SettingsPanel value="sign-in">
          <Section
            title="Sign-in"
            description="Which methods people can use. At least one must stay enabled."
          >
            <AuthSection
              initial={config.auth}
              canMagicLink={Boolean(config.resend.apiKey)}
              canPasskey={secureOrigin}
            />
          </Section>
        </SettingsPanel>

        <SettingsPanel value="infrastructure">
          <Section
            title="Live updates"
            description="Optional Redis relay that makes new replies appear without a refresh."
          >
            <RealtimeSection
              initial={{
                url: config.redis.url ?? "",
                hasToken: Boolean(config.redis.token),
                transport,
              }}
              provenance={config.provenance}
            />
          </Section>

          <Section
            title="Background jobs"
            description="Inngest runs campaign sending, scheduling and inbound fetching. Not needed in local development."
          >
            <JobsSection
              initial={{
                hasEventKey: Boolean(config.inngest.eventKey),
                hasSigningKey: Boolean(config.inngest.signingKey),
              }}
              inngestUrl={`${base}/api/inngest`}
            />
          </Section>

          <Section
            title="Environment"
            description="The two values that cannot live in the database — settings stored in Postgres cannot contain the credentials to reach Postgres, and encrypted secrets cannot contain their own key. Change these in your .env.local or hosting platform."
          >
            <dl className="divide-y rounded-lg border">
              <div className="flex items-center justify-between px-3 py-2.5">
                <dt className="text-[12px] font-medium">DATABASE_URL</dt>
                <dd className="text-[11px] text-muted-foreground">
                  {process.env.DATABASE_URL ? "Set" : "Missing"}
                </dd>
              </div>
              <div className="flex items-center justify-between px-3 py-2.5">
                <dt className="text-[12px] font-medium">AUTH_SECRET</dt>
                <dd className="text-[11px] text-muted-foreground">
                  {process.env.AUTH_SECRET ? "Set" : "Missing"}
                </dd>
              </div>
            </dl>
          </Section>
        </SettingsPanel>
      </SettingsTabs>
    </Panel>
  );
}
