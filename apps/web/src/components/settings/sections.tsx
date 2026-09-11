"use client";

import { useState } from "react";
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
import { Input, SecretInput } from "@/components/ui/input";
import { NameInput } from "@/components/ui/name-input";
import { Switch } from "@/components/ui/switch";
import { Help } from "@/components/setup/help";
import { SaveState, useSectionAutosave } from "@/components/settings/autosave";
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
  const [fields, setFields] = useState({
    domain: initial.domain,
    fromEmail: initial.fromEmail,
    fromName: initial.fromName,
    postalAddress: initial.postalAddress,
    rate: String(initial.ratePerSecond),
  });
  /**
   * Held apart from `fields`, because they are the only two the section
   * does not autosave while typing, and because they are cleared after a
   * successful write — a stored secret is never read back, so leaving the
   * typed one on screen would claim the field holds something it does not.
   */
  const [apiKey, setApiKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  const autosave = useSectionAutosave(
    async (value: typeof fields & { apiKey: string; webhookSecret: string }) => {
      const result = await updateEmailSettings({
        domain: value.domain,
        fromEmail: value.fromEmail,
        fromName: value.fromName,
        postalAddress: value.postalAddress,
        ratePerSecond: Number(value.rate) || 10,
        apiKey: value.apiKey,
        webhookSecret: value.webhookSecret,
      });
      if (result.ok) {
        // Only once the write succeeded. Clearing on failure would lose a
        // key that was rejected for a reason the operator can fix, such as
        // a Resend outage, and leave them with nothing to correct.
        if (value.apiKey) setApiKey("");
        if (value.webhookSecret) setWebhookSecret("");
      }
      return result;
    },
  );

  /** A field changed: debounce a save of everything the section holds. */
  const edit = (patch: Partial<typeof fields>) => {
    const next = { ...fields, ...patch };
    setFields(next);
    // Secrets are deliberately empty here, which the action reads as "keep
    // the stored one". See the docblock in `autosave.tsx`.
    autosave.change({ ...next, apiKey: "", webhookSecret: "" });
  };

  /** A secret was blurred: save now, and only if something was typed. */
  const commitSecret = (patch: { apiKey?: string; webhookSecret?: string }) => {
    const value = patch.apiKey ?? patch.webhookSecret ?? "";
    if (!value.trim()) return;
    autosave.saveNow({ apiKey: "", webhookSecret: "", ...fields, ...patch });
  };

  return (
    <div className="space-y-4">
      <FieldRow
        label="API key"
        help={<Help topic="resendApiKey" />}
        note="Leave blank to keep the stored key. Pasting a new one replaces it."
      >
        <div className="flex items-center gap-2">
          <SecretInput
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onBlur={() => commitSecret({ apiKey })}
            placeholder="re_…"
          />
          <SecretState present={initial.hasKey} />
        </div>
        <Source provenance={provenance.resendApiKey} />
      </FieldRow>

      <FieldRow label="Sending domain" help={<Help topic="resendDomain" />}>
        <Input
          value={fields.domain}
          onChange={(e) => edit({ domain: e.target.value })}
          onBlur={autosave.flush}
          spellCheck={false}
        />
        <Source provenance={provenance.resendDomain} />
      </FieldRow>

      <div className="grid gap-4 sm:grid-cols-2">
        <FieldRow label="From address">
          <Input
            value={fields.fromEmail}
            onChange={(e) => edit({ fromEmail: e.target.value })}
            onBlur={autosave.flush}
            spellCheck={false}
          />
        </FieldRow>
        <FieldRow label="From name">
          <NameInput
            value={fields.fromName}
            onChange={(e) => edit({ fromName: e.target.value })}
            onBlur={autosave.flush}
          />
        </FieldRow>
      </div>

      <FieldRow
        label="Postal address"
        note="Printed in every campaign footer. CAN-SPAM requires a physical address on commercial mail, and filters read its absence as a sign the sender cannot be found. Not used for transactional mail."
      >
        <textarea
          value={fields.postalAddress}
          onChange={(e) => edit({ postalAddress: e.target.value })}
          onBlur={autosave.flush}
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
          value={fields.rate}
          onChange={(e) => edit({ rate: e.target.value })}
          onBlur={autosave.flush}
          type="number"
          min={1}
          max={1000}
          className="w-28"
        />
      </FieldRow>

      <FieldRow label="Webhook signing secret" help={<Help topic="resendWebhookSecret" />}>
        <div className="flex items-center gap-2">
          <SecretInput
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            onBlur={() => commitSecret({ webhookSecret })}
            placeholder="whsec_…"
          />
          <SecretState present={initial.hasWebhookSecret} />
        </div>
      </FieldRow>

      <CopyBox label="Webhook endpoint — point Resend here" value={webhookUrl} />

      <SaveState status={autosave.status} error={autosave.error} savedAt={autosave.savedAt} />
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

  const autosave = useSectionAutosave(
    async (value: { url: string; token: string }) => {
      const result = await updateRealtimeSettings(value);
      if (result.ok && value.token) setToken("");
      return result;
    },
  );

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
          onChange={(e) => {
            setUrl(e.target.value);
            // The token stays out of a URL edit: blank means "keep the
            // stored one", so changing the URL never disturbs it.
            autosave.change({ url: e.target.value, token: "" });
          }}
          onBlur={autosave.flush}
          placeholder="redis://localhost:6379"
          spellCheck={false}
        />
        <Source provenance={provenance.redisRestUrl} />
      </FieldRow>

      {isRest ? (
        <FieldRow label="Upstash REST token" note="Leave blank to keep the stored token.">
          <div className="flex items-center gap-2">
            <SecretInput
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onBlur={() => {
                if (token.trim()) autosave.saveNow({ url, token });
              }}
            />
            <SecretState present={initial.hasToken} />
          </div>
        </FieldRow>
      ) : null}

      <SaveState status={autosave.status} error={autosave.error} savedAt={autosave.savedAt} />
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

  /**
   * Both fields are secrets, so this section only ever saves on blur —
   * there is nothing here that autosaves while typing.
   */
  const autosave = useSectionAutosave(
    async (value: { eventKey: string; signingKey: string }) => {
      const result = await updateJobSettings(value);
      if (result.ok) {
        if (value.eventKey) setEventKey("");
        if (value.signingKey) setSigningKey("");
      }
      return result;
    },
  );

  const commit = (patch: { eventKey?: string; signingKey?: string }) => {
    const value = patch.eventKey ?? patch.signingKey ?? "";
    if (!value.trim()) return;
    autosave.saveNow({ eventKey: "", signingKey: "", ...patch });
  };

  return (
    <div className="space-y-4">
      <FieldRow label="Event key" help={<Help topic="inngest" />}>
        <div className="flex items-center gap-2">
          <SecretInput
            value={eventKey}
            onChange={(e) => setEventKey(e.target.value)}
            onBlur={() => commit({ eventKey })}
          />
          <SecretState present={initial.hasEventKey} />
        </div>
      </FieldRow>

      <FieldRow label="Signing key">
        <div className="flex items-center gap-2">
          <SecretInput
            value={signingKey}
            onChange={(e) => setSigningKey(e.target.value)}
            onBlur={() => commit({ signingKey })}
          />
          <SecretState present={initial.hasSigningKey} />
        </div>
      </FieldRow>

      <CopyBox label="Inngest endpoint — point your app here" value={inngestUrl} />

      <SaveState status={autosave.status} error={autosave.error} savedAt={autosave.savedAt} />
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

  /**
   * A toggle commits immediately rather than after a debounce. There is no
   * partially-typed state for a switch, and a switch that has visibly moved
   * while the setting behind it has not is the one thing this section must
   * not do — "Open registration" is on that list.
   */
  const autosave = useSectionAutosave(async (value: typeof initial) => {
    const result = await updateAuthSettings(value);
    /**
     * Snap back on refusal.
     *
     * The switch moved the instant it was pressed, which is right — but if
     * the server refuses (the last sign-in method cannot be turned off), a
     * switch left sitting in the position it was refused is a lie about how
     * people can get in. Reverting to the *server's* last known state, not
     * to a diff, because that is the only value known to have been
     * accepted.
     */
    if (!result.ok) setState(initial);
    return result;
  });

  const toggle = (patch: Partial<typeof initial>) => {
    const next = { ...state, ...patch };
    setState(next);
    autosave.saveNow(next);
  };

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
              onCheckedChange={(value) => toggle({ [row.key]: value })}
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
          onCheckedChange={(value) => toggle({ allowSignup: value })}
          aria-label="Open registration"
        />
      </div>

      <SaveState status={autosave.status} error={autosave.error} savedAt={autosave.savedAt} />
    </div>
  );
}
