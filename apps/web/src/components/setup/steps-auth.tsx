"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { adminAccountSchema, type AdminAccountInput } from "@sendstack/shared";
import { Fingerprint, KeyRound, Mail, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { signUp } from "@sendstack/auth/client";
import { finishSetup, openAccountCreation, saveAuthConfig } from "@/actions/setup";
import { Button } from "@/components/ui/button";
import { Field, invalid } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { NameInput } from "@/components/ui/name-input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { StepCard } from "./shell";
import { Help } from "./help";

const METHODS = [
  {
    key: "emailPassword" as const,
    icon: Mail,
    name: "Email and password",
    blurb: "The familiar option. Works everywhere, including on a phone that is not yours.",
    help: undefined,
  },
  {
    key: "passkey" as const,
    icon: Fingerprint,
    name: "Passkeys",
    blurb: "Face ID, Touch ID, Windows Hello or a security key. Nothing to remember or leak.",
    help: "passkey" as const,
  },
  {
    key: "magicLink" as const,
    icon: KeyRound,
    name: "Magic links",
    blurb: "A one-time sign-in link sent by email. No password at all.",
    help: "magicLink" as const,
  },
];

export function AuthStep({
  initial,
  canMagicLink,
  canPasskey,
  onDone,
  onBack,
}: {
  initial: { emailPassword: boolean; passkey: boolean; magicLink: boolean };
  canMagicLink: boolean;
  canPasskey: boolean;
  onDone: () => void;
  onBack: () => void;
}) {
  const [methods, setMethods] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const none = !methods.emailPassword && !methods.passkey && !methods.magicLink;

  const blockedReason = (key: keyof typeof methods): string | null => {
    if (key === "magicLink" && !canMagicLink) {
      return "Add a Resend API key first — the link is delivered by email.";
    }
    if (key === "passkey" && !canPasskey) {
      return "Passkeys need an https:// app URL (localhost is exempt).";
    }
    return null;
  };

  return (
    <StepCard
      title="How will you sign in?"
      description="Pick at least one. You can add more later, and each person chooses which to use. Sign-in is never optional — this app can email your entire contact list, so an instance anyone can open is not something we let you build by accident."
      footer={
        <>
          <Button variant="ghost" onClick={onBack}>
            Back
          </Button>
          <Button
            disabled={pending || none}
            onClick={() =>
              start(async () => {
                const result = await saveAuthConfig(methods);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                onDone();
              })
            }
          >
            Save & continue
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {METHODS.map((method) => {
          const Icon = method.icon;
          const blocked = blockedReason(method.key);
          const enabled = methods[method.key];
          return (
            <div
              key={method.key}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-3 transition-colors",
                enabled ? "bg-accent/50" : "bg-card",
                blocked && "opacity-60",
              )}
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-medium">{method.name}</span>
                  {method.help ? <Help topic={method.help} /> : null}
                </div>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {blocked ?? method.blurb}
                </p>
              </div>
              <Switch
                checked={enabled}
                disabled={Boolean(blocked)}
                onCheckedChange={(value) =>
                  setMethods((current) => ({ ...current, [method.key]: value }))
                }
                aria-label={method.name}
              />
            </div>
          );
        })}
      </div>

      {none ? (
        <div className="flex gap-2 rounded-md bg-signal-warning/10 p-2.5">
          <TriangleAlert className="mt-px size-3.5 shrink-0 text-signal-warning" />
          <p className="text-[11px] leading-relaxed">
            At least one method must stay on, or nobody can get back into this instance — there is
            no recovery short of editing the database by hand.
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-md bg-destructive/10 px-2.5 py-2 text-[12px] text-destructive">
          {error}
        </p>
      ) : null}
    </StepCard>
  );
}

export function AccountStep({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<AdminAccountInput>({
    resolver: zodResolver(adminAccountSchema),
    mode: "onBlur",
    defaultValues: { name: "", email: "", password: "" },
  });

  const password = watch("password");

  const onSubmit = handleSubmit((values) =>
    start(async () => {
      setError(null);

      // Registration is closed by default. Open it for exactly this call and
      // close it again in finishSetup, so the window is never left ajar.
      const opened = await openAccountCreation();
      if (!opened.ok) {
        setError(opened.error);
        return;
      }

      const result = await signUp.email(values);
      if (result.error) {
        setError(result.error.message ?? "Could not create the account.");
        return;
      }

      const finished = await finishSetup();
      if (!finished.ok) {
        setError(finished.error);
        return;
      }

      toast.success("Sendstack is ready");
      router.push("/inbox");
      router.refresh();
    }),
  );

  return (
    <form onSubmit={onSubmit} noValidate>
      <StepCard
        title="Create your account"
        description="The first and, for now, only account. Sign-up closes again the moment this finishes."
        footer={
          <>
            <Button type="button" variant="ghost" onClick={onBack}>
              Back
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Finish setup"}
            </Button>
          </>
        }
      >
        <Field
          label="Your name"
          error={errors.name}
          hint="Capitalised as you type — no need for shift."
        >
          <NameInput {...register("name")} {...invalid(errors.name)} autoComplete="name" />
        </Field>

        <Field label="Email" error={errors.email}>
          <Input
            {...register("email")}
            {...invalid(errors.email)}
            type="email"
            autoComplete="email"
            spellCheck={false}
          />
        </Field>

        <Field
          label="Password"
          error={errors.password}
          hint={
            password.length > 0 && password.length < 12
              ? `${12 - password.length} more characters needed.`
              : "At least 12 characters."
          }
        >
          <Input
            {...register("password")}
            {...invalid(errors.password)}
            type="password"
            autoComplete="new-password"
          />
        </Field>

        {error ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-2.5 py-2 text-[12px] text-destructive">
            {error}
          </p>
        ) : null}
      </StepCard>
    </form>
  );
}
