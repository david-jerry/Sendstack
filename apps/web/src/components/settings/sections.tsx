"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Lock, X } from "lucide-react";
import { toast } from "sonner";
import type { Provenance } from "@sendstack/config";
import {
  updateAuthSettings,
  updateEmailSettings,
  updateJobSettings,
  updateRealtimeSettings,
} from "@/actions/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NameInput } from "@/components/ui/name-input";
import { Switch } from "@/components/ui/switch";
import { Help } from "@/components/setup/help";
import { FieldRow } from "@/components/setup/shell";

/**
 * Where a value came from.
 *
 * Values resolve database-first with environment variables as a first-run seed,
 * so a field can legitimately be showing something the operator set on their
 * host — or something that will be *ignored* because the database now has its
 * own value. Saying which, per field, is what prevents the "I changed the env
 * var and nothing happened" afternoon.
 */
export function Source({ provenance }: { provenance: Provenance | undefined }) {
  if (provenance === "environment") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Lock className="size-2.5" />
        seeded from environment
      </span>
    );
  }
  if (provenance === "database") {
    return <span className="text-[11px] text-muted-foreground">saved here</span>;
  }
  // Cleared deliberately in Settings. Said explicitly, because the environment
  // may still hold a value for this field and the label is what tells the
  // operator that it is being ignored on purpose rather than by accident.
  if (provenance === "cleared") {
    return <span className="text-[11px] text-muted-foreground">cleared here</span>;
  }
  return <span className="text-[11px] text-muted-foreground/60">not set</span>;
}

export function SecretState({ present }: { present: boolean }) {
  return present ? (
    <Badge tone="success">
      <Check className="size-3" />
      Saved
    </Badge>
  ) : (
    <Badge tone="danger">
      <X className="size-3" />
      Missing
    </Badge>
  );
}

/**
 * A value that exists to be copied: a webhook URL, an endpoint, a prompt.
 *
 * `multiline` is for the prompts. A URL is one line and scrolls sideways; a
 * prompt is forty lines and must scroll *down*, clipped at a height that
 * shows it is a document without taking the page over. Same button, same
 * toast, one component — two boxes that copied slightly differently is how
 * the second one ends up without the "Copied" confirmation.
 */
export function CopyBox({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-secondary/40 p-3">
      <p className="text-[11px] font-medium">{label}</p>
      <div className={multiline ? "mt-1.5 flex items-start gap-2" : "mt-1.5 flex items-center gap-2"}>
        <code
          className={
            multiline
              ? "scroll-subtle max-h-56 flex-1 overflow-y-auto rounded bg-card px-2 py-1.5 text-[11px] leading-relaxed whitespace-pre-wrap"
              : "scroll-subtle flex-1 overflow-x-auto rounded bg-card px-2 py-1 text-[11px] whitespace-nowrap"
          }
        >
          {value}
        </code>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(value);
            toast.success("Copied");
          }}
        >
          <Copy className="size-3" />
        </Button>
      </div>
    </div>
  );
}

export function EmailSection({
  initial,
  provenance,
  webhookUrl,
}: {
  initial: {
    domain: string;
    fromEmail: string;
    fromName: string;
    postalAddress: string;
    ratePerSecond: number;
    hasKey: boolean;
    hasWebhookSecret: boolean;
  };
  provenance: Record<string, Provenance>;
  webhookUrl: string;
}) {
  const [domain, setDomain] = useState(initial.domain);
  const [fromEmail, setFromEmail] = useState(initial.fromEmail);
  const [fromName, setFromName] = useState(initial.fromName);
  const [postalAddress, setPostalAddress] = useState(initial.postalAddress);
  const [rate, setRate] = useState(String(initial.ratePerSecond));
  const [apiKey, setApiKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      const result = await updateEmailSettings({
        domain,
        fromEmail,
        fromName,
        postalAddress,
        ratePerSecond: Number(rate) || 10,
        apiKey,
        webhookSecret,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setApiKey("");
      setWebhookSecret("");
      toast.success("Email settings saved");
    });

  return (
    <div className="space-y-4">
      <FieldRow
        label="API key"
        help={<Help topic="resendApiKey" />}
        note="Leave blank to keep the stored key. Pasting a new one replaces it."
      >
        <div className="flex items-center gap-2">
          <Input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="re_…"
            type="password"
            autoComplete="off"
            spellCheck={false}
          />
          <SecretState present={initial.hasKey} />
        </div>
        <Source provenance={provenance.resendApiKey} />
      </FieldRow>

      <FieldRow label="Sending domain" help={<Help topic="resendDomain" />}>
        <Input value={domain} onChange={(e) => setDomain(e.target.value)} spellCheck={false} />
        <Source provenance={provenance.resendDomain} />
      </FieldRow>

      <div className="grid gap-4 sm:grid-cols-2">
        <FieldRow label="From address">
          <Input
            value={fromEmail}
            onChange={(e) => setFromEmail(e.target.value)}
            spellCheck={false}
          />
        </FieldRow>
        <FieldRow label="From name">
          <NameInput value={fromName} onChange={(e) => setFromName(e.target.value)} />
        </FieldRow>
      </div>

      <FieldRow
        label="Postal address"
        note="Printed in every campaign footer. CAN-SPAM requires a physical address on commercial mail, and filters read its absence as a sign the sender cannot be found. Not used for transactional mail."
      >
        <textarea
          value={postalAddress}
          onChange={(e) => setPostalAddress(e.target.value)}
          rows={3}
          placeholder={"Acme Ltd\n1 High Street\nLondon EC1A 1AA"}
          spellCheck={false}
          className="scroll-subtle flex w-full rounded-md border bg-card px-2.5 py-1.5 text-[13px] shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25"
        />
      </FieldRow>

      <FieldRow
        label="Send rate"
        note="Messages per second. Match your Resend plan — exceeding it earns 429s and hurts your domain's reputation."
      >
        <Input
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          type="number"
          min={1}
          max={1000}
          className="w-28"
        />
      </FieldRow>

      <FieldRow label="Webhook signing secret" help={<Help topic="resendWebhookSecret" />}>
        <div className="flex items-center gap-2">
          <Input
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder="whsec_…"
            type="password"
            autoComplete="off"
            spellCheck={false}
          />
          <SecretState present={initial.hasWebhookSecret} />
        </div>
      </FieldRow>

      <CopyBox label="Webhook endpoint — point Resend here" value={webhookUrl} />

      <Button onClick={save} disabled={pending}>
        {pending ? "Saving…" : "Save email settings"}
      </Button>
    </div>
  );
}

export function RealtimeSection({
  initial,
  provenance,
}: {
  initial: { url: string; hasToken: boolean; transport: "upstash" | "tcp" | null };
  provenance: Record<string, Provenance>;
}) {
  const [url, setUrl] = useState(initial.url);
  const [token, setToken] = useState("");
  const [pending, start] = useTransition();

  const isRest = /^https?:\/\//i.test(url.trim());
  const isWire = /^rediss?:\/\//i.test(url.trim());

  return (
    <div className="space-y-4">
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Optional. Resend has no streaming API, so inbound mail arrives by webhook on whichever
        instance the platform picks — Redis relays it to the browser holding your inbox open.
        Without it everything still works; you refresh to see new replies.
      </p>

      {initial.transport ? (
        <Badge tone="success">
          <Check className="size-3" />
          Connected over {initial.transport === "tcp" ? "the Redis protocol" : "Upstash REST"}
        </Badge>
      ) : null}

      <FieldRow
        label="Redis URL"
        help={<Help topic="redis" />}
        note={
          isWire
            ? "A Redis server. No token needed — credentials belong in the URL."
            : isRest
              ? "Upstash's REST API. Needs the token below."
              : "redis://localhost:6379, or an https:// REST URL from Upstash. Clear to turn live updates off."
        }
      >
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="redis://localhost:6379"
          spellCheck={false}
        />
        <Source provenance={provenance.redisRestUrl} />
      </FieldRow>

      {isRest ? (
        <FieldRow label="Upstash REST token" note="Leave blank to keep the stored token.">
          <div className="flex items-center gap-2">
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              type="password"
              autoComplete="off"
              spellCheck={false}
            />
            <SecretState present={initial.hasToken} />
          </div>
        </FieldRow>
      ) : null}

      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await updateRealtimeSettings({ url, token });
            if (!result.ok) toast.error(result.error);
            else {
              setToken("");
              toast.success(url ? "Live updates enabled" : "Live updates turned off");
            }
          })
        }
      >
        {pending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

export function JobsSection({
  initial,
  inngestUrl,
}: {
  initial: { hasEventKey: boolean; hasSigningKey: boolean };
  inngestUrl: string;
}) {
  const [eventKey, setEventKey] = useState("");
  const [signingKey, setSigningKey] = useState("");
  const [pending, start] = useTransition();

  return (
    <div className="space-y-4">
      <FieldRow label="Event key" help={<Help topic="inngest" />}>
        <div className="flex items-center gap-2">
          <Input
            value={eventKey}
            onChange={(e) => setEventKey(e.target.value)}
            type="password"
            autoComplete="off"
          />
          <SecretState present={initial.hasEventKey} />
        </div>
      </FieldRow>

      <FieldRow label="Signing key">
        <div className="flex items-center gap-2">
          <Input
            value={signingKey}
            onChange={(e) => setSigningKey(e.target.value)}
            type="password"
            autoComplete="off"
          />
          <SecretState present={initial.hasSigningKey} />
        </div>
      </FieldRow>

      <CopyBox label="Inngest endpoint — point your app here" value={inngestUrl} />

      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            await updateJobSettings({ eventKey, signingKey });
            setEventKey("");
            setSigningKey("");
            toast.success("Job settings saved");
          })
        }
      >
        {pending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

export function AuthSection({
  initial,
  canMagicLink,
  canPasskey,
}: {
  initial: { emailPassword: boolean; passkey: boolean; magicLink: boolean; allowSignup: boolean };
  canMagicLink: boolean;
  canPasskey: boolean;
}) {
  const [state, setState] = useState(initial);
  const [pending, start] = useTransition();

  const rows = [
    { key: "emailPassword" as const, name: "Email and password", blocked: null as string | null },
    {
      key: "passkey" as const,
      name: "Passkeys",
      blocked: canPasskey ? null : "Needs an https:// app URL.",
    },
    {
      key: "magicLink" as const,
      name: "Magic links",
      blocked: canMagicLink ? null : "Needs a working Resend key.",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-3 rounded-lg border p-3">
            <div className="min-w-0 flex-1">
              <span className="text-[13px] font-medium">{row.name}</span>
              {row.blocked ? (
                <p className="mt-0.5 text-[11px] text-muted-foreground">{row.blocked}</p>
              ) : null}
            </div>
            <Switch
              checked={state[row.key]}
              disabled={Boolean(row.blocked)}
              onCheckedChange={(value) => setState((s) => ({ ...s, [row.key]: value }))}
              aria-label={row.name}
            />
          </div>
        ))}
      </div>

      <div className="flex items-start gap-3 rounded-lg border border-signal-warning/40 bg-signal-warning/5 p-3">
        <div className="min-w-0 flex-1">
          <span className="text-[13px] font-medium">Open registration</span>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            Anyone who can reach this URL can create an account. This instance can email your whole
            contact list — turn it on only while adding someone, then turn it off.
          </p>
        </div>
        <Switch
          checked={state.allowSignup}
          onCheckedChange={(value) => setState((s) => ({ ...s, allowSignup: value }))}
          aria-label="Open registration"
        />
      </div>

      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await updateAuthSettings(state);
            if (!result.ok) {
              toast.error(result.error);
              setState(initial);
              return;
            }
            toast.success("Sign-in settings saved");
          })
        }
      >
        {pending ? "Saving…" : "Save sign-in settings"}
      </Button>
    </div>
  );
}
