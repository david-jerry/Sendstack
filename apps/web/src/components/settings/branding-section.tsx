"use client";

import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ImageUp, Trash2 } from "lucide-react";
import { DEFAULT_BRAND_COLOR, brandingFormSchema, isHexColor, type BrandingFormInput } from "@sendstack/shared";
import { updateBranding } from "@/actions/settings";
import { Button } from "@/components/ui/button";
import { Field, invalid } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { NameInput } from "@/components/ui/name-input";
import { CloudinaryFields } from "@/components/setup/cloudinary-fields";
import { Help } from "@/components/setup/help";
import { SaveState, useSectionAutosave } from "@/components/settings/autosave";

function AssetPicker({
  name,
  currentUrl,
  accept,
  hint,
  onChanged,
}: {
  name: "logo" | "favicon";
  currentUrl: string | null;
  accept: string;
  hint: string;
  /**
   * Picking or removing an image commits immediately rather than waiting
   * for a debounce. There is no half-chosen file, and an image that
   * visibly changed while the stored one did not is the kind of thing
   * somebody discovers in a campaign a week later.
   */
  onChanged: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removed, setRemoved] = useState(false);
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
            if (file) {
              setPreview(URL.createObjectURL(file));
              setRemoved(false);
              onChanged();
            }
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
                setRemoved(true);
                onChanged();
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

export function BrandingSection({
  initial,
}: {
  initial: {
    appName: string;
    appUrl: string;
    primaryColor: string;
    logoUrl: string | null;
    faviconUrl: string | null;
    cloudinary: { cloudName: string; folder: string; hasCredentials: boolean };
  };
}) {
  const formRef = useRef<HTMLFormElement>(null);
  /**
   * Bumped per edit so each scheduled save is a distinct value.
   *
   * The payload is read out of the form at save time rather than carried
   * here — a `FormData` built per keystroke would clone any staged image
   * with it, and the whole point of the debounce is that most of those
   * snapshots are thrown away.
   */
  const tick = useRef(0);

  const autosave = useSectionAutosave(async () => {
    const element = formRef.current;
    // Unmounted mid-edit: `useAutosave` deliberately runs the queued save
    // on the way out, and there is no form left to read.
    if (!element) return { ok: true };
    return updateBranding(new FormData(element));
  });

  const edit = () => autosave.change(++tick.current);
  const commit = () => autosave.saveNow(++tick.current);

  // The same schema the wizard uses, so the two screens cannot disagree about
  // what a valid workspace name or app URL is.
  const {
    register,
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

  return (
    <form
      ref={formRef}
      /**
       * One pair of handlers on the form rather than composed onto each
       * `register()`. React events bubble, so this catches every input in
       * the section — including `CloudinaryFields`, which this component
       * does not own — and cannot be forgotten when a field is added.
       */
      onChange={edit}
      onBlur={autosave.flush}
      onSubmit={(event) => {
        // Nothing to submit; Enter in a text field must not reload the page.
        event.preventDefault();
        autosave.flush();
      }}
      noValidate
      className="space-y-4"
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
            <Input {...register("primaryColor")} {...invalid(errors.primaryColor)} spellCheck={false} />
          </div>
        </Field>
      </div>

      <Field
        label="App URL"
        error={errors.appUrl}
        hint="Used for auth callbacks, unsubscribe links, and the logo URL inside your emails. Changing it invalidates existing passkeys."
      >
        <Input {...register("appUrl")} {...invalid(errors.appUrl)} spellCheck={false} inputMode="url" />
      </Field>

      <CloudinaryFields initial={initial.cloudinary} register={register} errors={errors} compact />

      <Field label="Logo" help={<Help topic="logo" />}>
        <AssetPicker
          // Remounted on every successful save, which clears the staged
          // file. Without it the same image is re-uploaded on each
          // subsequent autosave for as long as the page stays open.
          key={`logo-${autosave.savedAt}`}
          name="logo"
          onChanged={commit}
          currentUrl={initial.logoUrl}
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          hint="Appears at the top of every campaign. PNG, JPEG, WebP or SVG up to 512KB."
        />
      </Field>

      <Field label="Favicon" help={<Help topic="favicon" />}>
        <AssetPicker
          key={`favicon-${autosave.savedAt}`}
          name="favicon"
          onChanged={commit}
          currentUrl={initial.faviconUrl}
          accept="image/png,image/x-icon,image/svg+xml"
          hint="The browser tab icon. PNG, ICO or SVG up to 512KB."
        />
      </Field>

      <SaveState status={autosave.status} error={autosave.error} savedAt={autosave.savedAt} />
    </form>
  );
}
