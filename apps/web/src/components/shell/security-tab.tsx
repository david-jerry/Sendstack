"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BadgeCheck, KeyRound, MailWarning } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@sendstack/auth/client";
import { changePasswordSchema, type ChangePasswordInput } from "@sendstack/shared";
import { Button } from "@/components/ui/button";
import { Field, invalid } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

/**
 * The two things somebody manages about their own credentials.
 *
 * Its own file rather than a fourth section inside `profile-dialog.tsx`, which
 * was already five components and five hundred lines. Nothing here is shared
 * with the other tabs, so nothing is lost by splitting it out.
 */

/**
 * Whether this address has been confirmed, and a way to ask again.
 *
 * `requireEmailVerification` is **off** on the server, deliberately — turning
 * it on would lock out the operator who has just finished the setup wizard on
 * an instance where Resend is the thing they were configuring, and that is a
 * lockout on the one account that could fix it. So verification is a state
 * worth showing rather than a gate, and this is where it is shown.
 *
 * The button is offered even to a verified address in one case only: it is
 * hidden entirely once verified, because re-sending then does nothing a person
 * would notice and invites them to wait for a mail with no purpose.
 */
function EmailVerification({ email, verified }: { email: string; verified: boolean }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (verified) {
    return (
      <div className="flex items-start gap-2.5 rounded-lg border border-signal-success/40 bg-signal-success/8 p-3">
        <BadgeCheck className="mt-px size-4 shrink-0 text-signal-success" />
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-signal-success">Email confirmed</p>
          <p className="mt-0.5 text-[12px] text-signal-success/90">{email}</p>
        </div>
      </div>
    );
  }

  const resend = async () => {
    setSending(true);
    try {
      const result = await authClient.sendVerificationEmail({
        email,
        // Where the link lands once the token is accepted. Better Auth
        // verifies server-side and then redirects here.
        callbackURL: "/inbox",
      });

      if (result.error) {
        toast.error(result.error.message ?? "Could not send the confirmation email.");
        return;
      }

      setSent(true);
      toast.success("Confirmation sent", {
        description: `Check ${email} for a link. It expires in 24 hours.`,
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-lg border border-signal-warning/40 bg-signal-warning/8 p-3">
      <div className="flex items-start gap-2.5">
        <MailWarning className="mt-px size-4 shrink-0 text-signal-warning" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-signal-warning">
            Email not confirmed
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-signal-warning">
            Nothing is blocked by this. It matters because an unconfirmed address might
            not be yours — a typo of a real address means this instance sends on behalf
            of a stranger, which for a mail platform is worth ruling out.
          </p>
        </div>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2.5"
        disabled={sending || sent}
        onClick={() => void resend()}
      >
        {sending ? "Sending…" : sent ? "Link sent" : "Send confirmation link"}
      </Button>
    </div>
  );
}

/**
 * Changing a password while signed in.
 *
 * The current password is required, and that is the point rather than
 * ceremony: without it a session left open on a shared machine is enough to
 * take the account over, since changing the password locks the real owner out.
 *
 * `revokeOtherSessions` is offered as a checkbox rather than forced. Both
 * answers are reasonable — somebody who suspects their password is known wants
 * every other session gone, and somebody just rotating a password does not
 * want to sign back in on four devices — and the checkbox says which is
 * happening. It defaults to on, because the first reason is why people
 * usually do this.
 */
function ChangePassword() {
  const [error, setError] = useState<string | null>(null);
  const [revokeOthers, setRevokeOthers] = useState(true);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { current: "", password: "", confirm: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);

    const result = await authClient.changePassword({
      currentPassword: values.current,
      newPassword: values.password,
      revokeOtherSessions: revokeOthers,
    });

    if (result.error) {
      /**
       * Echoed rather than rewritten.
       *
       * The failure that matters is "current password is wrong", and Better
       * Auth says so. Replacing it with something generic would leave somebody
       * retyping a new password they had got right.
       */
      setError(result.error.message ?? "Could not change your password.");
      return;
    }

    // Cleared on success: three password fields left populated after a save
    // is an invitation to submit them again, and the second attempt fails
    // because the "current" password is now the old one.
    reset({ current: "", password: "", confirm: "" });

    toast.success("Password changed", {
      description: revokeOthers
        ? "Your other devices have been signed out."
        : "Your other sessions are still signed in.",
    });
  });

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 rounded-lg border p-3"
    >
      <div className="flex items-center gap-2">
        <KeyRound className="size-3.5 text-muted-foreground" />
        <p className="text-[13px] font-medium">Change password</p>
      </div>

      <Field
        label="Current password"
        error={errors.current}
      >
        <Input
          type="password"
          // `current-password`, so a manager fills the existing one here…
          autoComplete="current-password"
          {...invalid(errors.current)}
          {...register("current")}
        />
      </Field>

      <Field
        label="New password"
        error={errors.password}
      >
        <Input
          type="password"
          // …and offers to generate a new one here. Getting these two the
          // wrong way round is what makes a manager autofill the old password
          // into the new field.
          autoComplete="new-password"
          {...invalid(errors.password)}
          {...register("password")}
        />
      </Field>

      <Field
        label="Confirm new password"
        error={errors.confirm}
      >
        <Input
          type="password"
          autoComplete="new-password"
          {...invalid(errors.confirm)}
          {...register("confirm")}
        />
      </Field>

      <label className="flex items-start gap-2 text-[12px] leading-relaxed text-muted-foreground">
        <input
          type="checkbox"
          checked={revokeOthers}
          onChange={(event) => setRevokeOthers(event.target.checked)}
          className="mt-0.5 size-3.5 shrink-0 accent-primary"
        />
        <span>
          Sign out my other devices. Leave this on if you think somebody else knows your
          password.
        </span>
      </label>

      {error ? (
        <p
          role="alert"
          className="rounded-md bg-destructive/10 px-2.5 py-2 text-[12px] text-destructive"
        >
          {error}
        </p>
      ) : null}

      <Button
        type="submit"
        size="sm"
        disabled={isSubmitting}
      >
        {isSubmitting ? "Saving…" : "Change password"}
      </Button>
    </form>
  );
}

/**
 * The Security tab: address confirmation, then the password form.
 *
 * In that order because the verification notice is a *state* somebody should
 * see whether or not they came here to change a password, and a warning below
 * a three-field form is a warning nobody reads.
 */
export function SecurityTab({ email, verified }: { email: string; verified: boolean }) {
  return (
    <div className="space-y-3">
      <EmailVerification
        email={email}
        verified={verified}
      />
      <ChangePassword />
    </div>
  );
}
