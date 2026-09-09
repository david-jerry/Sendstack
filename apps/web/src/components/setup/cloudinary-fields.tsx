"use client";

import { useState, useTransition } from "react";
import type { FieldErrors, UseFormRegister } from "react-hook-form";
import { Cloud, Database } from "lucide-react";
import type { BrandingFormInput } from "@sendstack/shared";
import { testCloudinary } from "@/actions/setup";
import { Button } from "@/components/ui/button";
import { Field, invalid } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Help } from "./help";
import { TestResult } from "./shell";

type TestState = { status: "idle" | "testing" | "ok" | "error"; message?: string };

/**
 * Image hosting, shared by the wizard and the settings page.
 *
 * It registers into whichever form wraps it rather than owning its own submit,
 * because the branding action has to save these credentials *before* it reads
 * the uploaded files — so a logo chosen in the same submission goes straight to
 * the CDN instead of the database.
 *
 * The key and secret are deliberately left blank on every visit: a password
 * field cannot be pre-filled, so blank means "keep what is stored". That rule
 * lives in `reconcileCloudinary`, and getting it wrong here once rejected every
 * setup whose credentials came from `.env`.
 */
export function CloudinaryFields({
  initial,
  register,
  errors,
  compact,
}: {
  initial: { cloudName: string; folder: string; hasCredentials: boolean };
  register: UseFormRegister<BrandingFormInput>;
  errors: FieldErrors<BrandingFormInput>;
  compact?: boolean;
}) {
  const [probe, setProbe] = useState({ cloudName: "", apiKey: "", apiSecret: "" });
  const [test, setTest] = useState<TestState>({ status: "idle" });
  const [pending, start] = useTransition();

  const active = initial.hasCredentials || Boolean(probe.cloudName && probe.apiKey && probe.apiSecret);
  const canTest = Boolean(probe.cloudName && probe.apiKey && probe.apiSecret);

  // RHF owns the values; these mirrors exist only so the Test button can send
  // what is currently typed without reading the DOM.
  const mirror =
    (key: keyof typeof probe) =>
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setProbe((current) => ({ ...current, [key]: event.target.value }));

  const cloudName = register("cloudinaryCloudName");
  const apiKey = register("cloudinaryApiKey");
  const apiSecret = register("cloudinaryApiSecret");

  return (
    <div className={cn("space-y-4 rounded-lg border p-3.5", compact && "p-3")}>
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md",
            active ? "bg-signal-success/12 text-signal-success" : "bg-secondary text-muted-foreground",
          )}
        >
          {active ? <Cloud className="size-3.5" /> : <Database className="size-3.5" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-medium">Image hosting</span>
            <Help topic="cloudinary" />
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {active ? (
              <>
                Uploads go to <strong className="font-medium text-foreground">Cloudinary</strong>,
                and your logo is served from their CDN — so recipients&apos; mail clients never hit
                this app.
              </>
            ) : (
              <>
                Uploads are stored in your{" "}
                <strong className="font-medium text-foreground">database</strong> and served by this
                app. That works, but every recipient who opens a campaign fetches your logo through
                a serverless function. Add Cloudinary to avoid that.
              </>
            )}
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Cloud name" optional error={errors.cloudinaryCloudName}>
          <Input
            {...cloudName}
            onChange={(event) => {
              void cloudName.onChange(event);
              mirror("cloudName")(event);
            }}
            {...invalid(errors.cloudinaryCloudName)}
            placeholder="your-cloud-name"
            spellCheck={false}
          />
        </Field>
        <Field label="Folder" optional error={errors.cloudinaryFolder}>
          <Input {...register("cloudinaryFolder")} placeholder="sendstack" spellCheck={false} />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="API key"
          optional
          error={errors.cloudinaryApiKey}
          hint={initial.hasCredentials ? "Saved — leave blank to keep it." : undefined}
        >
          <Input
            {...apiKey}
            onChange={(event) => {
              void apiKey.onChange(event);
              mirror("apiKey")(event);
            }}
            type="password"
            autoComplete="off"
            placeholder={initial.hasCredentials ? "•••••••• (saved)" : ""}
          />
        </Field>
        <Field
          label="API secret"
          optional
          error={errors.cloudinaryApiSecret}
          hint={initial.hasCredentials ? "Saved — leave blank to keep it." : undefined}
        >
          <Input
            {...apiSecret}
            onChange={(event) => {
              void apiSecret.onChange(event);
              mirror("apiSecret")(event);
            }}
            type="password"
            autoComplete="off"
            placeholder={initial.hasCredentials ? "•••••••• (saved)" : ""}
          />
        </Field>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || !canTest}
          onClick={() =>
            start(async () => {
              setTest({ status: "testing" });
              const result = await testCloudinary(probe);
              setTest(
                result.ok
                  ? { status: "ok", message: "Connected. Uploads will go to Cloudinary." }
                  : { status: "error", message: result.error },
              );
            })
          }
        >
          Test connection
        </Button>
        <TestResult state={test} />
      </div>
    </div>
  );
}
