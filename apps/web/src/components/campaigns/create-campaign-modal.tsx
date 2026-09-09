"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Megaphone, Plus } from "lucide-react";
import { toast } from "sonner";
import { campaignFormSchema, type CampaignFormInput, type TemplateRef } from "@sendstack/shared";
import { createCampaignDraft } from "@/actions/campaigns";
import { TemplatePicker } from "@/components/compose/template-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field, invalid } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { RichEditor } from "@/components/ui/rich-editor";

export type CampaignListOption = { id: string; name: string; memberCount: number };

/**
 * Creates a campaign, then goes to it.
 *
 * It creates a draft and stops. Sending is a separate, guarded transition on
 * the campaign's own page, where the recipient count is visible — a dialog
 * that both writes a message and fires it at four thousand people is one
 * mis-click away from being the worst button in the product.
 */
export function CreateCampaignModal({ lists }: { lists: CampaignListOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [template, setTemplate] = useState<TemplateRef>("simple");
  const [saving, startSaving] = useTransition();
  const text = useRef("");

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<CampaignFormInput>({
    resolver: zodResolver(campaignFormSchema),
    defaultValues: { name: "", subject: "", preheader: "", html: "", listId: "" },
    mode: "onBlur",
  });

  const listId = watch("listId");
  const chosen = lists.find((list) => list.id === listId);

  const submit = handleSubmit((values) => {
    startSaving(async () => {
      const result = await createCampaignDraft({
        name: values.name,
        subject: values.subject,
        preheader: values.preheader,
        html: values.html,
        listId: values.listId,
        template,
      });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success("Campaign created", {
        description: "Review the recipients, then send it from here.",
      });
      setOpen(false);
      reset();
      router.push(`/campaigns/${result.id}`);
      router.refresh();
    });
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          <Plus className="size-3.5" />
          New campaign
        </Button>
      </DialogTrigger>

      <DialogContent
        title="New campaign"
        description="A campaign pairs one message with one list. It is created as a draft — nothing is sent until you send it."
      >
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Campaign name" error={errors.name} hint="Only you see this.">
                <Input
                  {...register("name")}
                  {...invalid(errors.name)}
                  placeholder="March product update"
                  autoComplete="off"
                />
              </Field>

              <Field
                label="Send to"
                error={errors.listId}
                hint={
                  chosen
                    ? `${chosen.memberCount} ${chosen.memberCount === 1 ? "contact" : "contacts"} on this list`
                    : "Lists are managed on the Lists page."
                }
              >
                <Select {...register("listId")} {...invalid(errors.listId)}>
                  <option value="">Choose a list</option>
                  {lists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name} ({list.memberCount})
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <Field label="Subject" error={errors.subject}>
              <Input {...register("subject")} {...invalid(errors.subject)} autoComplete="off" />
            </Field>

            <Field
              label="Preview text"
              error={errors.preheader}
              optional
              hint="The line shown beside the subject in an inbox. Left empty, clients scrape the first words of the body."
            >
              <Input {...register("preheader")} {...invalid(errors.preheader)} autoComplete="off" />
            </Field>

            <TemplatePicker value={template} onChange={setTemplate} />

            <Field label="Message" error={errors.html}>
              <div className="rounded-md border px-1.5 py-1.5">
                <RichEditor
                  ariaLabel="Message"
                  value=""
                  bodyClassName="min-h-[180px] max-h-[34vh]"
                  placeholder="Hi {{ firstName }}, …"
                  onChange={(html, plain) => {
                    text.current = plain;
                    setValue("html", html, { shouldValidate: false });
                  }}
                />
              </div>
            </Field>

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Personalisation tags like <code>{"{{ firstName }}"}</code> are filled per
              recipient. An unsubscribe link is added automatically — it is required on
              bulk mail, and one-click unsubscribe is what keeps you out of spam folders.
            </p>
          </DialogBody>

          <DialogFooter>
            <Button type="submit" disabled={saving || lists.length === 0}>
              {saving ? <Loader2 className="animate-spin" /> : <Megaphone />}
              {saving ? "Creating…" : "Create draft"}
            </Button>
            {lists.length === 0 ? (
              <span className="text-[11px] text-muted-foreground">
                Create a list first — a campaign needs someone to go to.
              </span>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
