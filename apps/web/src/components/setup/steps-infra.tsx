"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  bootstrapSchema,
  emailConfigSchema,
  jobsConfigSchema,
  realtimeConfigSchema,
  type BootstrapInput,
  type EmailConfigInput,
  type JobsConfigInput,
  type RealtimeConfigInput,
} from "@sendstack/shared";
import {
  generateAuthSecret,
  saveBootstrap,
  saveEmailConfig,
  saveJobsConfig,
  saveRealtimeConfig,
  testRedis,
  testResendKey,
} from "@/actions/setup";
import { Button } from "@/components/ui/button";
import { Field, invalid } from "@/components/ui/form-field";
import { Input, SecretInput } from "@/components/ui/input";
import { NameInput } from "@/components/ui/name-input";
import { StepCard, TestResult } from "./shell";
import { Help } from "./help";

type TestState = { status: "idle" | "testing" | "ok" | "error"; message?: string };

export function BootstrapStep({ onDone }: { onDone: () => void }) {
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [manual, setManual] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<BootstrapInput>({
    resolver: zodResolver(bootstrapSchema),
    mode: "onBlur",
    defaultValues: { databaseUrl: "", authSecret: "" },
  });

  const onSubmit = handleSubmit((values) =>
    start(async () => {
      setTest({ status: "testing" });
      const result = await saveBootstrap(values);
      if (!result.ok) {
        setTest({ status: "error", message: result.error });
        return;
      }
      if (result.written) {
        setTest({ status: "ok", message: `Saved to ${result.filePath}. Restart to continue.` });
        toast.success("Saved. Restart the server — this page will move on by itself.");
      } else {
        // Read-only filesystem — almost always a serverless host.
        setManual(result.manual ?? null);
        setTest({
          status: "ok",
          message: "Verified, but this filesystem is read-only. Add these to your host instead.",
        });
      }
      onDone();
    }),
  );

  return (
    <form onSubmit={onSubmit} noValidate>
      <StepCard
        title="Connect a database"
        description="These two values are the only ones that cannot be stored in Sendstack itself — settings kept in Postgres cannot contain the credentials to reach Postgres, and encrypted secrets cannot contain their own key."
        footer={
          <>
            <span className="text-[11px] text-muted-foreground">Step 1 of 7</span>
            <Button type="submit" disabled={pending}>
              {pending ? "Testing…" : "Test & save"}
            </Button>
          </>
        }
      >
        <Field
          label="Postgres connection string"
          help={<Help topic="databaseUrl" />}
          error={errors.databaseUrl}
        >
          <Input
            {...register("databaseUrl")}
            {...invalid(errors.databaseUrl)}
            placeholder="postgresql://user:password@host/sendstack?sslmode=require"
            spellCheck={false}
            autoComplete="off"
          />
        </Field>

        <Field
          label="Auth secret"
          help={<Help topic="authSecret" />}
          error={errors.authSecret}
          hint="Signs sessions and every unsubscribe link. Treat it as permanent."
        >
          <div className="flex gap-2">
            <SecretInput
              {...register("authSecret")}
              {...invalid(errors.authSecret)}
              placeholder="at least 32 characters"
            />
            <Button
              type="button"
              variant="outline"
              onClick={async () =>
                setValue("authSecret", (await generateAuthSecret()).secret, {
                  shouldValidate: true,
                })
              }
            >
              <RefreshCw className="size-3.5" />
              Generate
            </Button>
          </div>
        </Field>

        <TestResult state={test} />

        {manual ? (
          <div className="rounded-lg border bg-secondary/40 p-3">
            <p className="text-[12px] font-medium">Add these to your hosting platform</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              This filesystem is read-only, so nothing was written. Set both in your host&apos;s
              environment variables and redeploy — this page will notice.
            </p>
            <pre className="scroll-subtle mt-2 overflow-x-auto rounded bg-card p-2 text-[11px]">
              {manual}
            </pre>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => {
                void navigator.clipboard.writeText(manual);
                toast.success("Copied");
              }}
            >
              <Copy className="size-3" />
              Copy
            </Button>
          </div>
        ) : null}
      </StepCard>
    </form>
  );
}

export function EmailStep({
  webhookUrl,
  initial,
  onDone,
  onBack,
}: {
  webhookUrl: string;
  initial: { domain: string; fromEmail: string; fromName: string; hasKey: boolean };
  onDone: () => void;
  onBack: () => void;
}) {
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [pending, start] = useTransition();

  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<EmailConfigInput>({
    resolver: zodResolver(emailConfigSchema),
    mode: "onBlur",
    defaultValues: {
      apiKey: "",
      domain: initial.domain,
      fromEmail: initial.fromEmail,
      fromName: initial.fromName,
      webhookSecret: "",
      hasStoredKey: initial.hasKey,
    },
  });

  const check = () =>
    start(async () => {
      setTest({ status: "testing" });
      const result = await testResendKey(getValues("apiKey") ?? "");
      setTest(
        result.ok
          ? {
              status: "ok",
              message:
                result.domains.length > 0
                  ? `Key works. Verified domains: ${result.domains.join(", ")}`
                  : "Key works, but no domains are verified yet. Add one in Resend.",
            }
          : { status: "error", message: result.error },
      );
      // Save a click: pre-fill the domain when there is exactly one choice.
      if (result.ok && result.domains.length === 1 && !getValues("domain")) {
        setValue("domain", result.domains[0]!, { shouldValidate: true });
      }
    });

  const onSubmit = handleSubmit((values) =>
    start(async () => {
      const result = await saveEmailConfig({
        apiKey: values.apiKey ?? "",
        domain: values.domain,
        fromEmail: values.fromEmail,
        fromName: values.fromName,
        webhookSecret: values.webhookSecret ?? "",
      });
      if (!result.ok) {
        setTest({ status: "error", message: result.error });
        return;
      }
      toast.success("Email configured");
      onDone();
    }),
  );

  return (
    <form onSubmit={onSubmit} noValidate>
      <StepCard
        title="Connect Resend"
        description="Resend sends your campaigns and receives the replies. It has no streaming API, so replies arrive by webhook — which is why the secret below matters."
        footer={
          <>
            <Button type="button" variant="ghost" onClick={onBack}>
              Back
            </Button>
            <Button type="submit" disabled={pending}>
              Save &amp; continue
            </Button>
          </>
        }
      >
        <Field
          label="API key"
          help={<Help topic="resendApiKey" />}
          error={errors.apiKey}
          hint={initial.hasKey ? "A key is already saved. Leave blank to keep it." : undefined}
        >
          <div className="flex gap-2">
            <SecretInput
              {...register("apiKey")}
              {...invalid(errors.apiKey)}
              placeholder={initial.hasKey ? "•••••••••••••• (saved)" : "re_..."}
            />
            <Button type="button" variant="outline" onClick={check} disabled={pending}>
              Test
            </Button>
          </div>
        </Field>

        <TestResult state={test} />

        <Field label="Sending domain" help={<Help topic="resendDomain" />} error={errors.domain}>
          <Input
            {...register("domain")}
            {...invalid(errors.domain)}
            placeholder="mail.example.com or abc123.resend.app"
            spellCheck={false}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From address" error={errors.fromEmail}>
            <Input
              {...register("fromEmail")}
              {...invalid(errors.fromEmail)}
              placeholder="hello@mail.example.com"
              spellCheck={false}
              inputMode="email"
            />
          </Field>
          <Field
            label="From name"
            error={errors.fromName}
            hint="Shown as the sender. Capitalised as you type."
          >
            <NameInput {...register("fromName")} {...invalid(errors.fromName)} placeholder="Acme" />
          </Field>
        </div>

        <Field
          label="Webhook signing secret"
          help={<Help topic="resendWebhookSecret" />}
          optional
          error={errors.webhookSecret}
          hint="Needed for replies and delivery tracking. You can add it after setup."
        >
          <SecretInput
            {...register("webhookSecret")}
            {...invalid(errors.webhookSecret)}
            placeholder="whsec_..."
          />
        </Field>

        <div className="rounded-lg border bg-secondary/40 p-3">
          <p className="text-[11px] font-medium">Point the Resend webhook here</p>
          <div className="mt-1.5 flex items-center gap-2">
            <code className="scroll-subtle flex-1 overflow-x-auto rounded bg-card px-2 py-1 text-[11px] whitespace-nowrap">
              {webhookUrl}
            </code>
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(webhookUrl);
                toast.success("Copied");
              }}
            >
              <Copy className="size-3" />
            </Button>
          </div>
        </div>
      </StepCard>
    </form>
  );
}

export function RealtimeStep({
  initial,
  onDone,
  onBack,
}: {
  initial: { url: string; hasToken?: boolean };
  onDone: () => void;
  onBack: () => void;
}) {
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [pending, start] = useTransition();

  const {
    register,
    handleSubmit,
    watch,
    getValues,
    setValue,
    formState: { errors },
  } = useForm<RealtimeConfigInput>({
    resolver: zodResolver(realtimeConfigSchema),
    mode: "onBlur",
    defaultValues: { url: initial.url, token: "", hasStoredToken: initial.hasToken ?? false },
  });

  const url = (watch("url") ?? "").trim();
  // The scheme decides the transport, so the token field only appears when it
  // is actually needed. Asking for an Upstash token beside a redis:// URL is
  // how someone concludes they need an Upstash account to use local Redis.
  const isRest = /^https?:\/\//i.test(url);
  const isWire = /^rediss?:\/\//i.test(url);

  const check = () =>
    start(async () => {
      setTest({ status: "testing" });
      const result = await testRedis(getValues("url") ?? "", getValues("token") ?? "");
      setTest(
        result.ok
          ? {
              status: "ok",
              message: `Connected over ${
                result.transport === "tcp" ? "the Redis protocol" : "Upstash REST"
              } — round trip ${result.latencyMs}ms.`,
            }
          : { status: "error", message: result.error },
      );
    });

  const onSubmit = handleSubmit((values) =>
    start(async () => {
      const result = await saveRealtimeConfig({
        url: values.url ?? "",
        token: values.token ?? "",
        skip: !values.url,
      });
      if (!result.ok) {
        setTest({ status: "error", message: result.error });
        return;
      }
      toast.success(values.url ? "Live updates enabled" : "Skipped — you can add Redis later");
      onDone();
    }),
  );

  return (
    <form onSubmit={onSubmit} noValidate>
      <StepCard
        title="Live updates"
        description="Optional. Resend delivers inbound mail by webhook, which lands on whichever server instance the platform picks — Redis relays it to the browser holding your inbox open. Without it, everything still works; you just refresh to see new replies."
        footer={
          <>
            <Button type="button" variant="ghost" onClick={onBack}>
              Back
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    await saveRealtimeConfig({ url: "", token: "", skip: true });
                    onDone();
                  })
                }
              >
                Skip for now
              </Button>
              <Button type="submit" disabled={pending}>
                Save &amp; continue
              </Button>
            </div>
          </>
        }
      >
        <Field
          label="Redis URL"
          help={<Help topic="redis" />}
          error={errors.url}
          hint={
            isWire
              ? "A Redis server. No token needed — any credentials go in the URL itself."
              : isRest
                ? "Upstash's REST API. Needs the token below as well."
                : "redis://localhost:6379 for a local server, or an https:// REST URL from Upstash."
          }
        >
          <div className="flex gap-2">
            <Input
              {...register("url")}
              {...invalid(errors.url)}
              placeholder="redis://localhost:6379"
              spellCheck={false}
            />
            {isWire ? (
              <Button type="button" variant="outline" onClick={check} disabled={pending}>
                Test
              </Button>
            ) : null}
          </div>
        </Field>

        {isRest ? (
          <Field label="Upstash REST token" error={errors.token}>
            <div className="flex gap-2">
              <SecretInput {...register("token")} {...invalid(errors.token)} />
              <Button type="button" variant="outline" onClick={check} disabled={pending}>
                Test
              </Button>
            </div>
          </Field>
        ) : null}

        <TestResult state={test} />

        {!url ? (
          <button
            type="button"
            onClick={() => setValue("url", "redis://localhost:6379", { shouldValidate: true })}
            className="text-[11px] text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Use redis://localhost:6379
          </button>
        ) : null}
      </StepCard>
    </form>
  );
}

export function JobsStep({
  inngestUrl,
  onDone,
  onBack,
}: {
  inngestUrl: string;
  onDone: () => void;
  onBack: () => void;
}) {
  const [pending, start] = useTransition();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<JobsConfigInput>({
    resolver: zodResolver(jobsConfigSchema),
    mode: "onBlur",
    defaultValues: { eventKey: "", signingKey: "" },
  });

  const save = handleSubmit((values) =>
    start(async () => {
      await saveJobsConfig({
        eventKey: values.eventKey ?? "",
        signingKey: values.signingKey ?? "",
      });
      onDone();
    }),
  );

  return (
    <form onSubmit={save} noValidate>
      <StepCard
        title="Background jobs"
        description="Inngest runs the send pipeline, the scheduler, and the job that fetches inbound message bodies. In local development you need no keys at all — the Inngest dev server discovers this app automatically."
        footer={
          <>
            <Button type="button" variant="ghost" onClick={onBack}>
              Back
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => void save()} disabled={pending}>
                Skip for now
              </Button>
              <Button type="submit" disabled={pending}>
                Save &amp; continue
              </Button>
            </div>
          </>
        }
      >
        <Field label="Event key" help={<Help topic="inngest" />} optional error={errors.eventKey}>
          <SecretInput {...register("eventKey")} />
        </Field>

        <Field label="Signing key" optional error={errors.signingKey}>
          <SecretInput {...register("signingKey")} />
        </Field>

        <div className="rounded-lg border bg-secondary/40 p-3">
          <p className="text-[11px] font-medium">Point your Inngest app here</p>
          <code className="scroll-subtle mt-1.5 block overflow-x-auto rounded bg-card px-2 py-1 text-[11px] whitespace-nowrap">
            {inngestUrl}
          </code>
        </div>
      </StepCard>
    </form>
  );
}
