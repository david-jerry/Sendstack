"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ThemeToggle } from "@sendstack/theme";
import { useSetupStream, type SetupSnapshot } from "@/hooks/use-setup-stream";
import { LiveStatus } from "./live-status";
import { STEPS, Stepper, type StepId } from "./shell";
import { BrandingStep } from "./steps-brand";
import { BootstrapStep, EmailStep, JobsStep, RealtimeStep } from "./steps-infra";
import { AccountStep, AuthStep } from "./steps-auth";

export type WizardData = {
  needsBootstrap: boolean;
  startAt: StepId;
  appName: string;
  appUrl: string;
  primaryColor: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  cloudinary: { cloudName: string; folder: string; hasCredentials: boolean };
  resendDomain: string;
  resendFromEmail: string;
  resendFromName: string;
  hasResendKey: boolean;
  redisRestUrl: string;
  auth: { emailPassword: boolean; passkey: boolean; magicLink: boolean };
  canMagicLink: boolean;
  canPasskey: boolean;
  webhookUrl: string;
  inngestUrl: string;
};

/**
 * Step orchestration lives on the client; every step's work is a Server Action.
 *
 * Progress is also written to `app_settings.setup_step` as each step completes,
 * so closing the tab and coming back resumes where you left off rather than
 * starting over — which matters when one of the steps is "go and create an
 * account on another website".
 */
export function Wizard({ data }: { data: WizardData }) {
  const router = useRouter();
  const [step, setStep] = useState<StepId>(data.startAt);

  const order = STEPS.map((s) => s.id).filter((id) =>
    id === "bootstrap" ? data.needsBootstrap : true,
  );
  const index = Math.max(0, order.indexOf(step));
  const done = order.slice(0, index);

  const go = (next: StepId) => {
    setStep(next);
    // Pull fresh server data for the step being entered.
    router.refresh();
  };
  const advance = () => go(order[Math.min(index + 1, order.length - 1)] ?? step);
  const back = () => go(order[Math.max(index - 1, 0)] ?? step);

  /**
   * Suppress the stream briefly after a manual Back.
   *
   * The server's `setup_step` only moves forward, so without this the stream's
   * next snapshot would immediately drag the user back to where they were —
   * making the Back button appear broken.
   */
  const manualUntil = useRef(0);

  // The stream's callback needs the current step without being torn down and
  // rebuilt every time it changes. Written in an effect, not during render —
  // concurrent React may render a component it then throws away.
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const onStage = useCallback(
    (snapshot: SetupSnapshot) => {
      // The database went away or the schema is missing: the page needs the
      // server-rendered fatal screen, which only a refresh can produce.
      if (
        snapshot.stage === "no-secret" ||
        snapshot.stage === "no-database" ||
        snapshot.stage === "needs-migration"
      ) {
        router.refresh();
        return;
      }

      // Bootstrap finished elsewhere — the restart landed and there is now a
      // database. Re-render so the wizard drops the bootstrap step entirely.
      if (data.needsBootstrap) {
        router.refresh();
        return;
      }

      if (snapshot.stage === "needs-admin") {
        if (stepRef.current !== "account") go("account");
        return;
      }

      if (snapshot.stage !== "incomplete" || !snapshot.step) return;
      if (Date.now() < manualUntil.current) return;

      const target = snapshot.step as StepId;
      if (!order.includes(target) || target === stepRef.current) return;

      // Only follow the server forward. It has no idea the user pressed Back.
      if (order.indexOf(target) > order.indexOf(stepRef.current)) go(target);
    },
    // `order` is derived from a stable prop and `go` from `order`; recreating
    // this callback on every render would not change behaviour but would
    // churn the ref it is stored in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.needsBootstrap, router],
  );

  const { status } = useSetupStream({ onStage });

  const goBack = () => {
    manualUntil.current = Date.now() + 8_000;
    back();
  };

  return (
    <div className="mx-auto w-full max-w-[560px] space-y-5 py-10">
      <div className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-[15px] font-medium">Set up {data.appName}</h1>
          <div className="flex items-center gap-3">
            <LiveStatus status={status} />
            <span className="tabular text-[11px] text-muted-foreground">
              {index + 1} of {order.length}
            </span>
            <ThemeToggle />
          </div>
        </div>
        <Stepper current={step} done={done} />
      </div>

      {step === "bootstrap" ? <BootstrapStep onDone={advance} /> : null}

      {step === "branding" ? (
        <BrandingStep
          initial={{
            appName: data.appName,
            appUrl: data.appUrl,
            primaryColor: data.primaryColor,
            logoUrl: data.logoUrl,
            faviconUrl: data.faviconUrl,
            cloudinary: data.cloudinary,
          }}
          onDone={advance}
        />
      ) : null}

      {step === "email" ? (
        <EmailStep
          webhookUrl={data.webhookUrl}
          initial={{
            domain: data.resendDomain,
            fromEmail: data.resendFromEmail,
            fromName: data.resendFromName || data.appName,
            hasKey: data.hasResendKey,
          }}
          onDone={advance}
          onBack={goBack}
        />
      ) : null}

      {step === "realtime" ? (
        <RealtimeStep initial={{ url: data.redisRestUrl }} onDone={advance} onBack={goBack} />
      ) : null}

      {step === "jobs" ? (
        <JobsStep inngestUrl={data.inngestUrl} onDone={advance} onBack={goBack} />
      ) : null}

      {step === "auth" ? (
        <AuthStep
          initial={data.auth}
          canMagicLink={data.canMagicLink}
          canPasskey={data.canPasskey}
          onDone={advance}
          onBack={goBack}
        />
      ) : null}

      {step === "account" ? <AccountStep onBack={goBack} /> : null}

      <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
        This page updates itself — restart the server or add an environment variable and it moves
        on without a reload. Everything here can be changed later in Settings, except the database
        URL and auth secret, which live in your environment.
      </p>
    </div>
  );
}
