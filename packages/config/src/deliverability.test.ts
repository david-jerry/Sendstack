import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "./config";

const getConfig = vi.fn();
vi.mock("./config", () => ({ getConfig: () => getConfig() }));

const { assertCampaignDeliverability, deliverabilityReport } = await import("./deliverability");

/** A configuration with nothing wrong with it, for tests to break one field of. */
function healthy(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    appName: "Acme Mail",
    appUrl: "https://mail.acme.com",
    primaryColor: "#18181b",
    postalAddress: "Acme Ltd, 1 High Street, London, EC1A 1AA",
    emailTemplate: "simple",
    resend: {
      apiKey: "re_test",
      domain: "acme.com",
      fromEmail: "hello@acme.com",
      fromName: "Acme",
      webhookSecret: "whsec_test",
      ratePerSecond: 10,
    },
    redis: { url: null, token: null },
    cloudinary: {
      cloudName: null,
      apiKey: null,
      apiSecret: null,
      folder: "sendstack",
      configured: false,
    },
    inngest: { eventKey: null, signingKey: null },
    auth: { emailPassword: true, passkey: false, magicLink: false, allowSignup: false },
    setup: { step: "done", completedAt: new Date() },
    provenance: {},
    ...overrides,
  } as AppConfig;
}

function withResend(overrides: Partial<AppConfig["resend"]>): AppConfig {
  const base = healthy();
  return { ...base, resend: { ...base.resend, ...overrides } };
}

const check = (report: Awaited<ReturnType<typeof deliverabilityReport>>, id: string) =>
  report.checks.find((entry) => entry.id === id)!;

beforeEach(() => {
  getConfig.mockReset();
});

describe("deliverabilityReport", () => {
  it("passes everything on a correctly configured instance", async () => {
    getConfig.mockResolvedValue(healthy());
    const report = await deliverabilityReport();

    expect(report.blocking).toHaveLength(0);
    expect(report.warnings).toHaveLength(0);
    expect(report.canSendCampaigns).toBe(true);
  });

  it("blocks a localhost app URL", async () => {
    // Every unsubscribe link is built from this. A campaign sent with it gives
    // ten thousand people a link to a host that does not exist, and the ones
    // who want out press "report spam" instead.
    getConfig.mockResolvedValue(healthy({ appUrl: "http://localhost:3000" }));
    const report = await deliverabilityReport();

    expect(report.canSendCampaigns).toBe(false);
    expect(check(report, "app-url").passed).toBe(false);
    expect(check(report, "app-url").detail).toContain("localhost");
  });

  it("blocks a plain-http app URL even on a real host", async () => {
    // RFC 8058 one-click unsubscribe requires HTTPS; over http the button is
    // simply not shown, which is worse than not advertising it.
    getConfig.mockResolvedValue(healthy({ appUrl: "http://mail.acme.com" }));
    const report = await deliverabilityReport();

    expect(check(report, "app-url").passed).toBe(false);
    expect(report.canSendCampaigns).toBe(false);
  });

  it("blocks an unparseable app URL rather than assuming it is fine", async () => {
    getConfig.mockResolvedValue(healthy({ appUrl: "mail.acme.com" }));
    expect(check(await deliverabilityReport(), "app-url").passed).toBe(false);
  });

  it("accepts the app on a subdomain of the sending domain", async () => {
    getConfig.mockResolvedValue(healthy({ appUrl: "https://mail.acme.com" }));
    expect(check(await deliverabilityReport(), "link-alignment").passed).toBe(true);
  });

  it("accepts the app on the bare sending domain", async () => {
    getConfig.mockResolvedValue(healthy({ appUrl: "https://acme.com" }));
    expect(check(await deliverabilityReport(), "link-alignment").passed).toBe(true);
  });

  it("warns, but does not block, when links are on an unrelated host", async () => {
    // A working URL on the wrong domain still delivers; it just gets judged on
    // a domain with no reputation of its own.
    getConfig.mockResolvedValue(healthy({ appUrl: "https://acme-mail.vercel.app" }));
    const report = await deliverabilityReport();

    expect(check(report, "link-alignment").passed).toBe(false);
    expect(report.canSendCampaigns).toBe(true);
  });

  it("does not mistake a domain that merely ends the same way", async () => {
    // notacme.com must not count as aligned with acme.com.
    getConfig.mockResolvedValue(healthy({ appUrl: "https://mail.notacme.com" }));
    expect(check(await deliverabilityReport(), "link-alignment").passed).toBe(false);
  });

  it("blocks a from-address off the sending domain", async () => {
    // DKIM would sign for acme.com while the header says gmail.com: DMARC fails.
    getConfig.mockResolvedValue(withResend({ fromEmail: "hello@gmail.com" }));
    const report = await deliverabilityReport();

    expect(check(report, "from-address").passed).toBe(false);
    expect(report.canSendCampaigns).toBe(false);
  });

  it("blocks when no sending domain is configured at all", async () => {
    getConfig.mockResolvedValue(withResend({ domain: null }));
    expect((await deliverabilityReport()).canSendCampaigns).toBe(false);
  });

  it("warns about a no-reply sender", async () => {
    getConfig.mockResolvedValue(withResend({ fromEmail: "no-reply@acme.com" }));
    const report = await deliverabilityReport();

    expect(check(report, "from-name").passed).toBe(false);
    // Discouraging replies costs engagement; it does not break authentication.
    expect(report.canSendCampaigns).toBe(true);
  });

  it("warns about a missing postal address", async () => {
    getConfig.mockResolvedValue(healthy({ postalAddress: "   " }));
    expect(check(await deliverabilityReport(), "postal-address").passed).toBe(false);
  });

  it("warns when the bounce webhook is not configured", async () => {
    getConfig.mockResolvedValue(withResend({ webhookSecret: null }));
    expect(check(await deliverabilityReport(), "webhook").passed).toBe(false);
  });

  it("does not call the webhook configured when Resend cannot reach it", async () => {
    // A stored signing secret beside a localhost app URL is a webhook that has
    // never fired. Showing a green tick for it is how an instance mails
    // bounced addresses for a month without noticing.
    getConfig.mockResolvedValue(healthy({ appUrl: "http://localhost:3000" }));
    const webhook = check(await deliverabilityReport(), "webhook");

    expect(webhook.passed).toBe(false);
    expect(webhook.detail).toContain("no event has ever arrived");
  });
});

describe("assertCampaignDeliverability", () => {
  it("stays out of the way when everything is in order", async () => {
    getConfig.mockResolvedValue(healthy());
    await expect(assertCampaignDeliverability()).resolves.toBeUndefined();
  });

  it("refuses to send, and says which setting is wrong", async () => {
    getConfig.mockResolvedValue(healthy({ appUrl: "http://localhost:3000" }));
    await expect(assertCampaignDeliverability()).rejects.toThrow(/localhost/);
  });

  it("does not refuse over warnings alone", async () => {
    // A missing postal address is worth fixing. It is not worth blocking a
    // send that would otherwise arrive.
    getConfig.mockResolvedValue(healthy({ postalAddress: null }));
    await expect(assertCampaignDeliverability()).resolves.toBeUndefined();
  });
});
