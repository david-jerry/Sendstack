/**
 * The "how do I get this?" content for every credential the wizard asks for.
 *
 * Kept as data rather than scattered through JSX so the whole set can be read
 * — and corrected — in one place. Every provider changes its dashboard wording
 * eventually, and a stale instruction is worse than none.
 */
export type HelpTopic = {
  title: string;
  /** One line on what this value actually is. */
  summary: string;
  steps: string[];
  /** Where to go. Opened in a new tab. */
  link?: { label: string; href: string };
  /** The one thing people get wrong. */
  gotcha?: string;
};

export const HELP: Record<string, HelpTopic> = {
  databaseUrl: {
    title: "Postgres connection string",
    summary: "Where Sendstack stores contacts, campaigns and everything else.",
    steps: [
      "Create a free project at neon.tech (or use Supabase, RDS, or your own Postgres 14+).",
      "Open the project dashboard and find the connection string.",
      "Choose the POOLED string — the host contains “-pooler”.",
      "Paste it here and press Test.",
    ],
    link: { label: "Create a Neon database", href: "https://neon.tech" },
    gotcha:
      "Use the pooled connection string, not the direct one. Serverless functions open many short-lived connections and will exhaust a direct connection limit.",
  },

  authSecret: {
    title: "Auth secret",
    summary: "Signs your login sessions and every unsubscribe link you send.",
    steps: [
      "Run `openssl rand -base64 32` in a terminal.",
      "Paste the result here, or press Generate to make one in your browser.",
    ],
    gotcha:
      "Treat this as permanent. Changing it signs everyone out, makes stored API keys unreadable, and breaks the unsubscribe link in every email you have ever sent — those must keep working for years.",
  },

  resendApiKey: {
    title: "Resend API key",
    summary: "Lets Sendstack send campaigns and read the replies.",
    steps: [
      "Sign in at resend.com and open API Keys.",
      "Create a key with Full access — it needs both sending and receiving permission.",
      "Copy it now; Resend will not show it again.",
    ],
    link: { label: "Open Resend API keys", href: "https://resend.com/api-keys" },
    gotcha:
      "A sending-only key looks like it works — campaigns go out — but the inbox stays permanently empty, because reading received mail is a separate permission.",
  },

  resendDomain: {
    title: "Sending domain",
    summary: "The domain your mail comes from and arrives at.",
    steps: [
      "Easiest start: in Resend, open Domains and use the <id>.resend.app subdomain you already have. It needs no DNS and can receive mail immediately.",
      "For your own domain: add it in Resend and create the SPF, DKIM and DMARC records it shows.",
      "To receive replies, also add the MX record from the domain's Receiving tab.",
    ],
    link: { label: "Open Resend domains", href: "https://resend.com/domains" },
    gotcha:
      "Without the MX record, mail sent to your domain never reaches Sendstack — the inbox will simply stay empty with no error anywhere.",
  },

  resendWebhookSecret: {
    title: "Resend webhook secret",
    summary: "Proves that incoming webhook requests really came from Resend.",
    steps: [
      "In Resend, open Webhooks and add an endpoint.",
      "Point it at the URL shown beside this field.",
      "Subscribe to every event type. Sendstack stores all of them, tracks delivery from the email.* ones, mirrors Resend's suppression list, and shows domain and contact changes in the Activity bell.",
      "Copy the signing secret — it starts with whsec_ — and paste it here.",
    ],
    link: { label: "Open Resend webhooks", href: "https://resend.com/webhooks" },
    gotcha:
      "Without this, Sendstack rejects every webhook — which is correct. An unauthenticated endpoint would let anyone forge a bounce and get an address suppressed on your instance.",
  },

  redis: {
    title: "Redis (optional)",
    summary: "Makes new replies appear instantly instead of on refresh.",
    steps: [
      "Already running Redis? Use redis://localhost:6379 — nothing else needed.",
      "Docker: `docker compose up -d redis`, then the same URL.",
      "Managed: Redis Cloud, Railway or Fly give you a redis:// or rediss:// URL.",
      "Serverless: create a database at console.upstash.com and paste its REST URL and token.",
    ],
    link: { label: "Open the Upstash console", href: "https://console.upstash.com" },
    gotcha:
      "The scheme decides everything. redis:// speaks the normal Redis protocol and needs no token — credentials go in the URL. https:// is Upstash's REST API and does need a token. On serverless, prefer Upstash: a redis:// connection has to be re-established on every cold start.",
  },

  inngest: {
    title: "Inngest (optional in development)",
    summary: "Runs campaign sending, scheduling and inbound fetching in the background.",
    steps: [
      "Local development needs no keys — `pnpm dev` starts the Inngest dev server and finds this app automatically.",
      "For production, create an app at app.inngest.com.",
      "Point it at the URL shown beside this field.",
      "Copy the Event Key and the Signing Key.",
    ],
    link: { label: "Open Inngest", href: "https://app.inngest.com" },
    gotcha:
      "In production without these, campaigns are queued but never actually sent — nothing errors, they just sit there.",
  },

  cloudinary: {
    title: "Cloudinary (recommended)",
    summary: "Hosts your logo and favicon on a CDN instead of inside the app.",
    steps: [
      "Create a free account at cloudinary.com.",
      "Open the Dashboard — the Cloud name, API key and API secret are on it.",
      "Paste all three here and press Test.",
    ],
    link: { label: "Open the Cloudinary dashboard", href: "https://console.cloudinary.com" },
    gotcha:
      "Worth doing before you send anything. Your logo is embedded in every campaign, so each recipient's mail client fetches it — served from the app, that is one serverless function call per recipient per open. A 50,000-person send turns one image into tens of thousands of invocations. Skip this and it still works, using your database instead.",
  },

  logo: {
    title: "Logo",
    summary: "Appears at the top of your emails and in the app header.",
    steps: [
      "PNG, JPEG, WebP or SVG, up to 512KB.",
      "Roughly 3:1 and at least 120px tall reproduces well.",
      "A transparent PNG works on every template background.",
    ],
    gotcha:
      "Many recipients block images by default, so your logo's alt text — your app name — is what a large minority actually see. Keep the name accurate.",
  },

  favicon: {
    title: "Favicon",
    summary: "The small icon in the browser tab.",
    steps: ["PNG, ICO or SVG, up to 512KB.", "A square image of 32×32 or larger."],
  },

  passkey: {
    title: "Passkeys",
    summary: "Sign in with Face ID, Touch ID, Windows Hello or a security key.",
    steps: [
      "No account or key needed — it is built in.",
      "Each person registers a passkey from their own account settings after signing in.",
    ],
    gotcha:
      "Passkeys are bound to your exact domain and require HTTPS (localhost is exempt). Change the app URL later and existing passkeys stop working, so keep email or magic-link sign-in enabled as a way back in.",
  },

  magicLink: {
    title: "Magic links",
    summary: "Sign in from a link emailed to you, with no password.",
    steps: [
      "Requires a working Resend key and sending domain — the link arrives by email.",
      "Links expire after five minutes and can be used once.",
    ],
    gotcha:
      "If email delivery breaks, magic-link sign-in breaks with it. Keep a second method enabled.",
  },
};
