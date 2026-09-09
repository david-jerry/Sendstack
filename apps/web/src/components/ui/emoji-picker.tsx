"use client";

import { useMemo, useState } from "react";
import { Smile } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A small, dependency-free emoji picker.
 *
 * The obvious library weighs about 40MB unpacked because it ships image assets
 * and the full Unicode dataset — an absurd cost for putting a smiley in a
 * reply. These are native characters rendered by the system emoji font, so the
 * whole thing is a few kilobytes and looks native on every platform.
 *
 * A curated set rather than all 3,600: this is an email composer, and the long
 * tail of emoji is not what anyone reaches for in one.
 */
const GROUPS: { name: string; emoji: [string, string][] }[] = [
  {
    name: "Smileys",
    emoji: [
      ["😀", "grin smile happy"], ["😄", "smile happy joy"], ["😊", "blush smile"],
      ["🙂", "slight smile"], ["😉", "wink"], ["😍", "love heart eyes"],
      ["🤔", "thinking hmm"], ["😅", "sweat nervous laugh"], ["😂", "laugh tears joy"],
      ["🙃", "upside down"], ["😴", "sleep tired"], ["😎", "cool sunglasses"],
      ["🥳", "party celebrate"], ["😬", "grimace awkward"], ["😢", "sad cry"],
      ["😡", "angry mad"], ["🤯", "mind blown"], ["🤝", "handshake deal agree"],
    ],
  },
  {
    name: "Gestures",
    emoji: [
      ["👋", "wave hello hi"], ["👍", "thumbs up yes good"], ["👎", "thumbs down no"],
      ["👏", "clap applause"], ["🙏", "please thanks pray"], ["💪", "strong muscle"],
      ["🤞", "fingers crossed luck"], ["✌️", "peace victory"], ["👌", "ok perfect"],
      ["🫶", "heart hands love"], ["🙌", "raise hands celebrate"], ["✍️", "writing"],
    ],
  },
  {
    name: "Work",
    emoji: [
      ["📧", "email mail message"], ["📨", "incoming mail"], ["📎", "attachment clip"],
      ["📅", "calendar date"], ["⏰", "clock time reminder"], ["📊", "chart stats"],
      ["📈", "growth up chart"], ["📌", "pin important"], ["✅", "check done yes"],
      ["❌", "cross no wrong"], ["⚠️", "warning caution"], ["💡", "idea lightbulb"],
      ["🔗", "link url"], ["📝", "note memo write"], ["🚀", "launch ship rocket"],
      ["🔥", "fire hot urgent"], ["⭐", "star favourite"], ["🎯", "target goal"],
    ],
  },
  {
    name: "Objects",
    emoji: [
      ["❤️", "heart love red"], ["🎉", "party tada celebrate"], ["🎁", "gift present"],
      ["☕", "coffee break"], ["🍕", "pizza food"], ["🌍", "world globe earth"],
      ["💰", "money cash payment"], ["🏆", "trophy win award"], ["🔔", "bell notify"],
      ["📞", "phone call"], ["💬", "speech chat comment"], ["🧠", "brain smart"],
    ],
  },
];

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return GROUPS;
    return GROUPS.map((group) => ({
      name: group.name,
      emoji: group.emoji.filter(([, keywords]) => keywords.includes(term)),
    })).filter((group) => group.emoji.length > 0);
  }, [search]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Insert emoji"
          title="Insert emoji"
          className={cn(
            "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground",
            "transition-colors hover:bg-accent hover:text-foreground",
            "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
          )}
        >
          <Smile className="size-3.5" />
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-[268px] p-2" align="start">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search…"
          className="h-7 text-[12px]"
          autoFocus
        />

        <div className="scroll-subtle mt-2 max-h-[210px] overflow-y-auto">
          {groups.length === 0 ? (
            <p className="px-1 py-4 text-center text-[11px] text-muted-foreground">
              Nothing matches “{search}”.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.name} className="mb-1.5">
                <p className="px-1 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground/70">
                  {group.name}
                </p>
                <div className="grid grid-cols-8 gap-0.5">
                  {group.emoji.map(([emoji, keywords]) => (
                    <button
                      key={emoji}
                      type="button"
                      title={keywords.split(" ")[0]}
                      onClick={() => {
                        onPick(emoji);
                        setOpen(false);
                        setSearch("");
                      }}
                      className="flex size-7 items-center justify-center rounded text-[16px] leading-none transition-colors hover:bg-accent"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
