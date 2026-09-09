"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The search box every list screen shares.
 *
 * The term lives in the URL, not in component state, for three reasons that
 * all matter: a filtered list can be linked to and bookmarked, Back undoes a
 * search instead of leaving the page, and the server component that renders
 * the first page reads the same value the client fetches with — so a reload
 * shows the results rather than an unfiltered list that corrects itself.
 *
 * Typing is debounced before it reaches the URL. Writing on every keystroke
 * would put a history entry and a request behind each letter.
 */
export function ListSearch({
  placeholder,
  busy = false,
  className,
}: {
  placeholder: string;
  /** Shows a spinner in the field while the list behind it is fetching. */
  busy?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const committed = searchParams.get("q") ?? "";

  const [value, setValue] = useState(committed);

  /**
   * Take the URL's term only when the change came from somewhere else.
   *
   * Back, a link or a Clear button should replace what is in the box. Our own
   * debounced write should not: it lands a moment after typing stopped, and
   * copying it back would snap the caret and eat a trailing space someone was
   * mid-word on. `written` remembers what we put there so the two cases can be
   * told apart.
   *
   * Adjusted during render rather than in an effect — the React-documented
   * shape for "reset state when a prop changes", and one render cheaper than
   * painting the stale value first. Held in state rather than a ref because
   * a ref cannot be read during render.
   */
  const [sync, setSync] = useState({ seen: committed, written: committed });
  if (committed !== sync.seen) {
    setSync((previous) => ({ seen: committed, written: previous.written }));
    if (committed !== sync.written) setValue(committed);
  }

  useEffect(() => {
    if (value.trim() === committed) return;

    const timer = setTimeout(() => {
      const term = value.trim();
      const next = new URLSearchParams(searchParams.toString());
      if (term) next.set("q", term);
      else next.delete("q");
      // A new term is a new list, so any cursor from the old one is meaningless.
      next.delete("cursor");

      setSync((previous) => ({ seen: previous.seen, written: term }));
      const query = next.toString();
      // `replace`, not `push`: one history entry per search, not per letter.
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, 300);

    return () => clearTimeout(timer);
  }, [value, committed, pathname, router, searchParams]);

  return (
    <div className={cn("relative flex items-center", className)}>
      <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        spellCheck={false}
        autoComplete="off"
        className="pr-8 pl-8"
      />
      {busy ? (
        <Loader2 className="pointer-events-none absolute right-2.5 size-3.5 animate-spin text-muted-foreground" />
      ) : value ? (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label="Clear search"
          className="absolute right-0.5 size-7"
          onClick={() => setValue("")}
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}
