"use client";

import { useRef, useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ImageUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_BRAND_COLOR, brandingFormSchema, isHexColor, type BrandingFormInput } from "@sendstack/shared";
import { saveBranding } from "@/actions/setup";
import { Button } from "@/components/ui/button";
import { Field, invalid } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { NameInput } from "@/components/ui/name-input";
import { CloudinaryFields } from "./cloudinary-fields";
import { StepCard } from "./shell";
import { Help } from "./help";

/**
 * A file picker that previews locally before upload.
 *
 * `URL.createObjectURL` shows the chosen file immediately, without a round
 * trip — which matters because the alternative is uploading a wrong logo,
 * seeing it in the header, and uploading again.
 *
 * Files stay outside React Hook Form deliberately: RHF validates values, and a
 * `File` is validated by the server (size, type) where the bytes actually are.
 */
function AssetPicker({
  name,
  currentUrl,
  accept,
  hint,
  onRemove,
  removed,
}: {
  name: "logo" | "favicon";
  currentUrl: string | null;
  accept: string;
  hint: string;
  onRemove: () => void;
  removed: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const shown = preview ?? (removed ? null : currentUrl);

  return (
    <div className="flex items-start gap-3">
      <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-secondary/40">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt="" className="max-h-12 max-w-12 object-contain" />
        ) : (
          <ImageUp className="size-4 text-muted-foreground/60" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <input
          ref={input}
          type="file"
          name={name}
          accept={accept}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) setPreview(URL.createObjectURL(file));
          }}
        />
        <input type="hidden" name={`remove_${name}`} value={removed ? "true" : "false"} />

        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
            Choose file
          </Button>
          {shown ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setPreview(null);
                if (input.current) input.current.value = "";
                onRemove();
              }}
            >
              <Trash2 className="size-3" />
              Remove
            </Button>
          ) : null}
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

export function BrandingStep({
  initial,
  onDone,
}: {
  initial: {
    appName: string;
    appUrl: string;
    primaryColor: string;
    logoUrl: string | null;
    faviconUrl: string | null;
    cloudinary: { cloudName: string; folder: string; hasCredentials: boolean };
  };
  onDone: () => void;
}) {
  const [removedLogo, setRemovedLogo] = useState(false);
  const [removedFavicon, setRemovedFavicon] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<BrandingFormInput>({
    resolver: zodResolver(brandingFormSchema),
    mode: "onBlur",
    defaultValues: {
      appName: initial.appName,
      appUrl: initial.appUrl,
      primaryColor: initial.primaryColor,
      cloudinaryCloudName: initial.cloudinary.cloudName,
      cloudinaryApiKey: "",
      cloudinaryApiSecret: "",
      cloudinaryFolder: initial.cloudinary.folder,
    },
  });

  const color = watch("primaryColor");

  /**
   * RHF validates; the FormData carries the files.
   *
   * A file input's value cannot be reconstructed from RHF state, so the actual
   * submission is built from the live form element. RHF's job here is to stop
   * a bad submission before it reaches the server and to put the message next
   * to the offending field.
   */
  const onSubmit = handleSubmit(() => {
    const element = formRef.current;
    if (!element) return;

    start(async () => {
      setError(null);
      const result = await saveBranding(new FormData(element));
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Branding saved");
      onDone();
    });
  });

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate>
      <StepCard
        title="Name and brand it"
        description="Your logo appears at the top of every campaign and in the app header. The brand colour drives buttons and template accents."
        footer={
          <>
            <span className="text-[11px] text-muted-foreground">Step 2 of 7</span>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save & continue"}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Workspace name"
            error={errors.appName}
            hint="Capitalised as you type. Acronyms like IBM are left alone."
          >
            <NameInput {...register("appName")} {...invalid(errors.appName)} maxLength={60} />
          </Field>

          <Field label="Brand colour" error={errors.primaryColor}>
            <div className="flex gap-2">
              <input
                type="color"
                value={isHexColor(color) ? color : DEFAULT_BRAND_COLOR}
                onChange={(event) =>
                  setValue("primaryColor", event.target.value, { shouldValidate: true })
                }
                aria-label="Pick a brand colour"
                className="h-8 w-10 shrink-0 cursor-pointer rounded-md border bg-card p-0.5"
              />
              <Input
                {...register("primaryColor")}
                {...invalid(errors.primaryColor)}
                spellCheck={false}
              />
            </div>
          </Field>
        </div>

        <Field
          label="App URL"
          error={errors.appUrl}
          hint="Where this instance is reachable. Used for auth callbacks, unsubscribe links, and the logo URL in your emails — so it must be the public address once you are live."
        >
          <Input
            {...register("appUrl")}
            {...invalid(errors.appUrl)}
            placeholder="https://mail.example.com"
            spellCheck={false}
            inputMode="url"
          />
        </Field>

        <CloudinaryFields
          initial={initial.cloudinary}
          register={register}
          errors={errors}
        />

        <Field label="Logo" help={<Help topic="logo" />} optional>
          <AssetPicker
            name="logo"
            currentUrl={initial.logoUrl}
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            hint="PNG, JPEG, WebP or SVG up to 512KB. Around 3:1 and at least 120px tall reproduces well in email."
            removed={removedLogo}
            onRemove={() => setRemovedLogo(true)}
          />
        </Field>

        <Field label="Favicon" help={<Help topic="favicon" />} optional>
          <AssetPicker
            name="favicon"
            currentUrl={initial.faviconUrl}
            accept="image/png,image/x-icon,image/svg+xml"
            hint="The browser tab icon. PNG, ICO or SVG up to 512KB. Square, 32×32 or larger."
            removed={removedFavicon}
            onRemove={() => setRemovedFavicon(true)}
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
