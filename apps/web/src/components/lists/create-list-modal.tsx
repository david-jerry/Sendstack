"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { listInputSchema, type ListInput } from "@sendstack/shared";
import { createList } from "@/actions/contacts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field, invalid } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";

export function CreateListModal() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, start] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ListInput>({
    resolver: zodResolver(listInputSchema),
    defaultValues: { name: "", description: "" },
    mode: "onBlur",
  });

  const submit = handleSubmit((values) => {
    start(async () => {
      const result = await createList(values);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // `createList` returns the existing list when the name is taken rather
      // than failing, so say which of the two happened.
      toast.success(result.created ? "List created" : `Using the existing “${result.name}”`);
      setOpen(false);
      reset();
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
          New list
        </Button>
      </DialogTrigger>

      <DialogContent
        title="New list"
        description="A list is who a campaign goes to. Contacts can be on as many as you like."
      >
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogBody className="flex flex-col gap-3">
            <Field label="Name" error={errors.name}>
              <Input
                {...register("name")}
                {...invalid(errors.name)}
                placeholder="Product announcements"
                autoComplete="off"
              />
            </Field>

            <Field
              label="Description"
              error={errors.description}
              optional
              hint="What this list is for. Only you see it."
            >
              <Textarea rows={3} {...register("description")} {...invalid(errors.description)} />
            </Field>
          </DialogBody>

          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Plus />}
              {saving ? "Creating…" : "Create list"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
