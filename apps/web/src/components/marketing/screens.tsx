import {
  Check,
  Inbox,
  Megaphone,
  Paperclip,
  PenLine,
  Palette,
  Send,
  ShieldBan,
  Star,
  Users,
} from "lucide-react";
import { TEMPLATE_KINDS, TEMPLATE_META, type TemplateKind } from "@sendstack/shared";
import { cn } from "@/lib/utils";

/**
 * Small, faithful renders of the product's own screens.
 *
 * A landing page has to show the thing. The two usual ways of doing that were
 * both worse than this: a screenshot goes stale the first time a padding value
 * changes, ships as a raster that needs producing twice for light and dark,
 * and blurs on a high-density display; a video is heavier and nobody watches
 * it.
 *
 * These are built from the same tokens as the application, so they follow the
 * reader's theme, stay sharp at any zoom, weigh nothing, and cannot drift from
 * the product in the way a picture of the product can.
 *
 * They are **replicas, not the components themselves**. Importing the real
 * `ThreadList` would drag its data fetching, its router hooks and its client
 * bundle onto a page that is otherwise static — and would break the moment one
 * of them starts requiring a session. The cost of the copy is that a redesign
 * has to touch both; the alternative was a marketing page that could not be
 * server-rendered.
 *
 * Every screen is `aria-hidden`. A screen reader walking a fake mailbox of
 * invented names would be reading furniture — the prose beside each one
 * carries the meaning.
 */

/**
 * The window chrome every screen sits in.
 *
 * A bare rectangle of UI reads as a broken screenshot. Three dots and a title
 * is enough to say "this is an application" without imitating any particular
 * operating system.
 */
function Frame({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "overflow-hidden rounded-2xl border bg-card shadow-xl shadow-black/5 dark:shadow-black/40",
        className,
      )}
    >
      <div className="flex h-8 items-center gap-1.5 border-b bg-secondary/50 px-3">
        <span className="size-2 rounded-full bg-muted-foreground/25" />
        <span className="size-2 rounded-full bg-muted-foreground/25" />
        <span className="size-2 rounded-full bg-muted-foreground/25" />
        <span className="ml-3 truncate text-[11px] text-muted-foreground">{title}</span>
      </div>
      {children}
    </div>
  );
}

/** The folder rail, shared by the screens that show it. */
const FOLDERS = [
  { label: "Inbox", icon: Inbox, count: "12", active: true },
  { label: "Starred", icon: Star },
  { label: "Sent", icon: Send },
  { label: "Drafts", icon: PenLine },
  { label: "Campaigns", icon: Megaphone },
  { label: "Contacts", icon: Users },
] as const;

function Rail() {
  return (
    <div className="hidden w-[118px] shrink-0 flex-col gap-0.5 border-r bg-sidebar p-2 sm:flex">
      <div className="mb-2 flex items-center gap-1.5 px-1">
        <span
          className="flex size-5 items-center justify-center rounded-md text-[10px] font-semibold"
          style={{ background: "var(--brand)", color: "var(--brand-foreground)" }}
        >
          S
        </span>
        <span className="text-[11px] font-semibold">Sendstack</span>
      </div>

      <div
        className="mb-2 rounded-md px-2 py-1.5 text-[10px] font-medium"
        style={{
          background: "color-mix(in oklab, var(--brand) 14%, transparent)",
          color: "var(--brand)",
        }}
      >
        New mail
      </div>

      {FOLDERS.map((folder) => (
        <div
          key={folder.label}
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1 text-[10px]",
            "active" in folder && folder.active
              ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
              : "text-muted-foreground",
          )}
        >
          <folder.icon className="size-3 shrink-0" />
          <span className="truncate">{folder.label}</span>
          {"count" in folder && folder.count ? (
            <span className="tabular ml-auto text-[9px] text-muted-foreground">
              {folder.count}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * The inbox: rail, thread list, reader with a real conversation.
 *
 * The names are figures from the history of computing rather than "John Doe" —
 * the point of a replica is to look like a mailbox somebody uses, and
 * placeholder names read as a placeholder.
 */
export function InboxScreen({ className }: { className?: string }) {
  const threads = [
    { from: "Ada Lovelace", subject: "Re: Analytical Engine notes", at: "9:41", unread: true },
    { from: "Grace Hopper", subject: "Invoice #204", at: "8:02" },
    { from: "Alan Turing", subject: "Re: Q3 numbers", at: "Yesterday" },
    { from: "Katherine Johnson", subject: "Unsubscribed", at: "Tue" },
  ];

  return (
    <Frame
      title="Inbox — Sendstack"
      className={className}
    >
      <div className="flex h-[300px] text-[11px] sm:h-[340px]">
        <Rail />

        <div className="flex w-full shrink-0 flex-col border-r sm:w-[168px] lg:w-[200px]">
          <div className="flex h-8 shrink-0 items-center border-b px-3 text-[11px] font-medium">
            Inbox
          </div>
          {threads.map((thread, index) => (
            <div
              key={thread.subject}
              className={cn("border-b px-3 py-2", index === 0 && "bg-accent")}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className={cn("truncate", thread.unread ? "font-semibold" : "font-medium")}>
                  {thread.from}
                </span>
                <span className="shrink-0 text-[9px] text-muted-foreground">{thread.at}</span>
              </div>
              <div className="truncate text-[10px] text-muted-foreground">{thread.subject}</div>
            </div>
          ))}
        </div>

        <div className="hidden min-w-0 flex-1 flex-col sm:flex">
          <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3">
            <span className="flex size-4 items-center justify-center rounded-full bg-signal-info/20 text-[8px] font-semibold text-signal-info">
              A
            </span>
            <span className="text-[11px] font-medium">Ada Lovelace</span>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-hidden bg-background/40 p-3">
            <div className="max-w-[85%] rounded-xl rounded-tl-sm border bg-card px-2.5 py-1.5 text-[10px]">
              Are the campaign notes ready for Thursday?
            </div>
            <div
              className="ml-auto max-w-[85%] rounded-xl rounded-tr-sm px-2.5 py-1.5 text-[10px]"
              style={{ background: "var(--brand)", color: "var(--brand-foreground)" }}
            >
              Sending them over — the list is 4,812 after suppressions.
            </div>
            <div className="max-w-[85%] rounded-xl rounded-tl-sm border bg-card px-2.5 py-1.5 text-[10px]">
              Thanks, that matches what I had.
            </div>
          </div>

          <div className="shrink-0 border-t p-2">
            <div className="rounded-md border bg-secondary/40 px-2.5 py-1.5 text-[10px] text-muted-foreground">
              Reply to ada@example.com…
            </div>
          </div>
        </div>
      </div>
    </Frame>
  );
}

/**
 * The composer, expanded — the state a reply is written in.
 *
 * Shows the two things the prose beside it claims: the draft saves itself as
 * you type, and attachments travel with the message.
 */
export function ComposerScreen({ className }: { className?: string }) {
  return (
    <Frame
      title="Reply — Ada Lovelace"
      className={className}
    >
      <div className="text-[11px]">
        <div className="flex items-center gap-2 border-b px-3 py-1.5">
          <PenLine className="size-3 text-muted-foreground" />
          <span className="text-[10px] font-medium">Reply</span>
          <span className="text-[9px] text-muted-foreground">Draft saved</span>
        </div>

        <div className="flex items-center gap-2 border-b px-3 py-1.5">
          <span className="text-[9px] text-muted-foreground">To</span>
          <span className="text-[10px]">ada@example.com</span>
        </div>

        <div className="p-2.5">
          <div className="min-h-[70px] rounded-md border bg-background/40 px-2.5 py-2 text-[10px] leading-relaxed">
            Notes attached — the figures are the post-audit ones, so they will not
            match the sheet from Monday.
          </div>

          <div className="mt-2 flex items-center gap-1.5 rounded-md border bg-secondary/40 px-2 py-1.5">
            <Paperclip className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate text-[10px]">q3-notes.pdf</span>
            <span className="ml-auto shrink-0 text-[9px] text-muted-foreground">184 KB</span>
          </div>

          <div className="mt-2 flex items-center gap-2">
            <span
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium"
              style={{ background: "var(--brand)", color: "var(--brand-foreground)" }}
            >
              <Send className="size-2.5" />
              Send
            </span>
            <span className="text-[9px] text-muted-foreground">⌘+Enter</span>
          </div>
        </div>
      </div>
    </Frame>
  );
}

/**
 * A campaign mid-send: guarded status, the counters, and the progress bar.
 *
 * The numbers are deliberately not round. A campaign showing 5,000 / 5,000
 * looks like a mockup; 4,690 delivered out of 4,812 with 18 bounced looks like
 * a send that actually happened.
 */
export function CampaignScreen({ className }: { className?: string }) {
  const stats = [
    { label: "Recipients", value: "4,812" },
    { label: "Delivered", value: "4,690" },
    { label: "Opened", value: "1,204" },
    { label: "Bounced", value: "18" },
  ];

  return (
    <Frame
      title="October update — Sendstack"
      className={className}
    >
      <div className="text-[11px]">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <span className="text-[11px] font-medium">October update</span>
          <span className="rounded-full bg-signal-info/15 px-1.5 py-0.5 text-[9px] font-medium text-signal-info">
            sending
          </span>
        </div>

        <div className="grid grid-cols-4 divide-x border-b">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="px-2 py-2"
            >
              <div className="text-[9px] text-muted-foreground">{stat.label}</div>
              <div className="tabular mt-0.5 text-[13px] font-medium">{stat.value}</div>
            </div>
          ))}
        </div>

        <div className="p-3">
          <div className="flex items-baseline justify-between text-[10px]">
            <span className="text-muted-foreground">Batch 39 of 41</span>
            <span className="tabular font-medium">97%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full"
              style={{ width: "97%", background: "var(--brand)" }}
            />
          </div>
          <p className="mt-2.5 text-[9px] leading-relaxed text-muted-foreground">
            Every message carries an idempotency key, so a retried batch cannot
            send twice.
          </p>
        </div>
      </div>
    </Frame>
  );
}

/**
 * Contacts, with the import result open.
 *
 * The rejected rows are the point. An importer that silently drops what it
 * cannot parse leaves somebody wondering why a list is short, and this screen
 * exists to show that this one says which row and why.
 */
export function ContactsScreen({ className }: { className?: string }) {
  const rows = [
    { name: "Ada Lovelace", email: "ada@example.com", company: "Analytical" },
    { name: "Grace Hopper", email: "grace@example.com", company: "Navy" },
    { name: "Alan Turing", email: "alan@example.com", company: "NPL" },
  ];

  return (
    <Frame
      title="Contacts — Sendstack"
      className={className}
    >
      <div className="text-[11px]">
        <div className="grid grid-cols-[1.1fr_1.3fr_0.8fr] border-b bg-secondary/30 px-3 py-1.5 text-[9px] font-medium text-muted-foreground">
          <span>Name</span>
          <span>Email</span>
          <span>Company</span>
        </div>

        {rows.map((row) => (
          <div
            key={row.email}
            className="grid grid-cols-[1.1fr_1.3fr_0.8fr] items-center border-b px-3 py-1.5 text-[10px]"
          >
            <span className="truncate font-medium">{row.name}</span>
            <span className="truncate text-muted-foreground">{row.email}</span>
            <span className="truncate text-muted-foreground">{row.company}</span>
          </div>
        ))}

        <div className="m-3 rounded-lg border border-signal-warning/40 bg-signal-warning/8 p-2.5">
          <div className="flex items-center gap-1.5">
            <Check className="size-3 shrink-0 text-signal-success" />
            <span className="text-[10px] font-medium">Imported 1,204 contacts</span>
          </div>
          <p className="mt-1 text-[9px] text-signal-warning">3 rows were not imported:</p>
          <ul className="mt-1 space-y-0.5 text-[9px] text-muted-foreground">
            <li>
              <span className="tabular">row 88</span> — “n/a” is not an email address
            </li>
            <li>
              <span className="tabular">row 412</span> — missing an email column
            </li>
            <li>
              <span className="tabular">row 903</span> — already on this list
            </li>
          </ul>
        </div>
      </div>
    </Frame>
  );
}

/**
 * The suppression list, with a bounce that cannot be removed.
 *
 * The locked row is the whole screen. A suppression list somebody can edit
 * their way around is a mailing list waiting to be blocked, so a hard bounce
 * has no delete control at all — and showing that is more convincing than
 * writing it.
 */
export function SuppressionScreen({ className }: { className?: string }) {
  const rows = [
    { email: "bounced@example.com", reason: "Hard bounce", locked: true, at: "2 Oct" },
    { email: "complained@example.com", reason: "Spam complaint", locked: true, at: "28 Sep" },
    { email: "asked@example.com", reason: "Unsubscribed", locked: false, at: "24 Sep" },
  ];

  return (
    <Frame
      title="Suppressions — Sendstack"
      className={className}
    >
      <div className="text-[11px]">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <ShieldBan className="size-3 text-muted-foreground" />
          <span className="text-[11px] font-medium">Suppressions</span>
          <span className="tabular ml-auto text-[9px] text-muted-foreground">312 addresses</span>
        </div>

        {rows.map((row) => (
          <div
            key={row.email}
            className="flex items-center gap-2 border-b px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[10px]">{row.email}</div>
              <div className="text-[9px] text-muted-foreground">
                {row.reason} · {row.at}
              </div>
            </div>
            {row.locked ? (
              <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[9px] text-muted-foreground">
                Permanent
              </span>
            ) : (
              <span className="shrink-0 text-[9px] text-muted-foreground underline">Remove</span>
            )}
          </div>
        ))}

        <p className="px-3 py-2 text-[9px] leading-relaxed text-muted-foreground">
          Bounces and complaints are recorded automatically and cannot be removed
          by hand — the receiving server’s verdict is not a preference.
        </p>
      </div>
    </Frame>
  );
}

/**
 * A step of the browser setup wizard, mid-test.
 *
 * The Test button is the detail worth showing: the wizard makes a real call
 * against the credential before it lets you save it, so a wrong key is caught
 * at the point of pasting rather than on the first send.
 */
export function SetupScreen({ className }: { className?: string }) {
  return (
    <Frame
      title="Setup — Sendstack"
      className={className}
    >
      <div className="text-[11px]">
        <div className="flex items-center gap-1.5 border-b px-3 py-2 text-[9px]">
          {["Branding", "Database", "Email", "Sign-in"].map((step, index) => (
            <span
              key={step}
              className={cn(
                "rounded-full px-2 py-0.5",
                index === 2
                  ? "font-medium"
                  : index < 2
                    ? "bg-signal-success/15 text-signal-success"
                    : "bg-secondary text-muted-foreground",
              )}
              style={
                index === 2
                  ? {
                      background: "color-mix(in oklab, var(--brand) 16%, transparent)",
                      color: "var(--brand)",
                    }
                  : undefined
              }
            >
              {index < 2 ? "✓ " : ""}
              {step}
            </span>
          ))}
        </div>

        <div className="space-y-2 p-3">
          <div>
            <div className="text-[9px] text-muted-foreground">Resend API key</div>
            <div className="mt-1 rounded-md border bg-background/40 px-2.5 py-1.5 text-[10px]">
              re_••••••••••••••••••••
            </div>
          </div>

          <div>
            <div className="text-[9px] text-muted-foreground">Sending domain</div>
            <div className="mt-1 rounded-md border bg-background/40 px-2.5 py-1.5 text-[10px]">
              mail.example.com
            </div>
          </div>

          <div className="flex items-center gap-2 pt-0.5">
            <span className="inline-flex items-center rounded-md border px-2 py-1 text-[10px] font-medium">
              Test connection
            </span>
            <span className="inline-flex items-center gap-1 text-[9px] text-signal-success">
              <Check className="size-2.5" />
              Sent a test message
            </span>
          </div>
        </div>
      </div>
    </Frame>
  );
}

/** A miniature stand-in for each design, distinct enough to read at 42% scale. */
function TemplateSwatch({ kind }: { kind: TemplateKind }) {
  switch (kind) {
    case "announcement":
      return (
        <div className="flex h-10 flex-col overflow-hidden rounded-md border bg-background/60">
          <div
            className="h-4 w-full"
            style={{ background: "var(--brand)" }}
          />
          <div className="flex-1 space-y-0.5 p-1">
            <div className="h-0.5 w-3/4 rounded-full bg-muted-foreground/30" />
            <div className="h-0.5 w-1/2 rounded-full bg-muted-foreground/20" />
          </div>
        </div>
      );
    case "newsletter":
      return (
        <div className="flex h-10 flex-col justify-center gap-1 rounded-md border bg-background/60 p-1.5">
          <div className="h-0.5 w-2/3 rounded-full bg-muted-foreground/40" />
          <div className="h-px w-full bg-border" />
          <div className="h-0.5 w-3/4 rounded-full bg-muted-foreground/25" />
          <div className="h-0.5 w-1/2 rounded-full bg-muted-foreground/25" />
        </div>
      );
    case "plain":
      return (
        <div className="flex h-10 flex-col justify-center gap-1 p-1.5">
          <div className="h-0.5 w-full rounded-full bg-muted-foreground/25" />
          <div className="h-0.5 w-5/6 rounded-full bg-muted-foreground/25" />
          <div className="h-0.5 w-2/3 rounded-full bg-muted-foreground/25" />
        </div>
      );
    case "simple":
    default:
      return (
        <div className="flex h-10 items-center justify-center rounded-md border bg-background/60">
          <div className="w-3/4 space-y-1 rounded-sm border bg-card p-1 shadow-2xs">
            <div className="mx-auto h-0.5 w-1/2 rounded-full bg-muted-foreground/30" />
            <div
              className="mx-auto h-1 w-1/3 rounded-full"
              style={{ background: "var(--brand)" }}
            />
          </div>
        </div>
      );
  }
}

/**
 * The design picker: four templates, one marked default.
 *
 * `simple` is shown as the default because that is the schema's actual
 * default (`email_template_kind` defaults to `"simple"`) — inventing a
 * different one here would show a screen the product doesn't have.
 */
export function TemplateScreen({ className }: { className?: string }) {
  const defaultKind: TemplateKind = "simple";

  return (
    <Frame
      title="Design — Sendstack"
      className={className}
    >
      <div className="text-[11px]">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Palette className="size-3 text-muted-foreground" />
          <span className="text-[11px] font-medium">Design</span>
          <span className="tabular ml-auto text-[9px] text-muted-foreground">
            Default: {TEMPLATE_META[defaultKind].name}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 p-2.5">
          {TEMPLATE_KINDS.map((kind) => {
            const active = kind === defaultKind;
            return (
              <div
                key={kind}
                className={cn(
                  "overflow-hidden rounded-md border",
                  active ? "ring-1" : "",
                )}
                style={active ? { borderColor: "var(--brand)", "--tw-ring-color": "var(--brand)" } as React.CSSProperties : undefined}
              >
                <TemplateSwatch kind={kind} />
                <div className="flex items-center gap-1 border-t bg-secondary/30 px-1.5 py-1">
                  <span className="truncate text-[9px] font-medium">{TEMPLATE_META[kind].name}</span>
                  {active ? (
                    <Check
                      className="ml-auto size-2.5 shrink-0"
                      style={{ color: "var(--brand)" }}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <p className="px-3 pb-2.5 text-[9px] leading-relaxed text-muted-foreground">
          Pick one per message, or set an instance-wide default in Settings —
          your logo and brand colour flow into whichever is chosen.
        </p>
      </div>
    </Frame>
  );
}
