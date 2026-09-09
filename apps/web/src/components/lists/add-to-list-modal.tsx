"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { addContactsToList, searchContactsForList } from "@/actions/contacts";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Candidate = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  onList: boolean;
};

/**
 * Puts existing contacts on a list.
 *
 * The search runs on the server. A mailing tool's contact table is the one
 * that is reliably large, and shipping all of it to a dialog so the browser
 * can filter it is the version that works until the day it matters.
 */
export function AddToListModal({ listId, listName }: { listId: string; listName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  /**
   * Which search term the rows in `candidates` belong to.
   *
   * `searching` is derived from this rather than stored, and that is not a
   * style preference: setting it inside the effect below is a synchronous
   * `setState` in an effect body, which the React compiler rejects outright
   * (`Calling setState synchronously within an effect can trigger cascading
   * renders`) and which was the only lint error in the repository — enough to
   * fail CI on every push, since `.github/workflows/ci.yml` runs `pnpm lint`.
   *
   * Deriving it also states the actual condition: the spinner is showing
   * because what is on screen is not an answer to what was typed. Null until
   * the first result lands, so the first open shows the spinner rather than an
   * empty list that looks like "no contacts".
   */
  const [loadedTerm, setLoadedTerm] = useState<string | null>(null);
  const searching = open && loadedTerm !== term;
  const [saving, start] = useTransition();

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      const rows = await searchContactsForList({ listId, term });
      if (cancelled) return;
      setCandidates(rows);
      setLoadedTerm(term);
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, term, listId]);

  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = () =>
    start(async () => {
      const result = await addContactsToList({ listId, contactIds: [...chosen] });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `${result.added} ${result.added === 1 ? "contact" : "contacts"} added to ${listName}`,
      );
      setOpen(false);
      setChosen(new Set());
      setTerm("");
      router.refresh();
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) return;
        setChosen(new Set());
        setTerm("");
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          <UserPlus className="size-3.5" />
          Add contacts
        </Button>
      </DialogTrigger>

      <DialogContent
        title={`Add contacts to ${listName}`}
        description="Search by name, email or company. Contacts already on this list are marked."
      >
        <DialogBody className="flex flex-col gap-2">
          <div className="relative">
            <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search contacts"
              className="pl-7"
              autoComplete="off"
            />
          </div>

          {searching && candidates.length === 0 ? (
            <p className="flex items-center gap-1.5 px-1 py-3 text-[12px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              Searching…
            </p>
          ) : candidates.length === 0 ? (
            <p className="px-1 py-3 text-[12px] text-muted-foreground">
              {term ? "No contact matches that." : "No contacts yet — add one from the Contacts page."}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {candidates.map((contact) => {
                const selected = chosen.has(contact.id);
                const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
                return (
                  <li key={contact.id}>
                    <button
                      type="button"
                      onClick={() => toggle(contact.id)}
                      disabled={contact.onList}
                      aria-pressed={selected}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                        contact.onList
                          ? "cursor-not-allowed opacity-50"
                          : selected
                            ? "bg-secondary"
                            : "hover:bg-accent",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded border",
                          selected && "border-primary bg-primary text-primary-foreground",
                        )}
                      >
                        {selected ? <Check className="size-3" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px]">
                          {name || contact.email}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {name ? contact.email : null}
                          {name && contact.company ? " · " : null}
                          {contact.company}
                        </span>
                      </span>
                      {contact.onList ? (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          Already on it
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogBody>

        <DialogFooter>
          <Button type="button" disabled={saving || chosen.size === 0} onClick={submit}>
            {saving ? <Loader2 className="animate-spin" /> : <UserPlus />}
            {chosen.size > 0 ? `Add ${chosen.size}` : "Add contacts"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
