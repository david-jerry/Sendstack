"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@sendstack/auth/client";
import {
  Fingerprint,
  ImageUp,
  Laptop,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  listActiveSessions,
  removeAvatar,
  revokeOtherSessions,
  revokeSession,
  updateDisplayName,
  uploadAvatar,
  type SessionSummary,
} from "@/actions/profile";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SecurityTab } from "@/components/shell/security-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type ProfileUser = {
  name: string;
  email: string;
  image: string | null;
  /**
   * Whether the address has been confirmed.
   *
   * Read from the session rather than fetched, because the app layout already
   * has it and a second round trip for a boolean would be waste. Shown rather
   * than enforced — see `SecurityTab` for why `requireEmailVerification` is
   * off on the server.
   */
  emailVerified: boolean;
};

/** Local dates only — the server has no idea what timezone the reader is in. */
function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * The profile picture, and the two things you can do to it.
 *
 * The preview is optimistic — an object URL shown the moment a file is picked,
 * before the upload has finished — because a 1MB upload over a slow connection
 * is long enough to make a silent form look broken.
 */
function AvatarField({ user, onChanged }: { user: ProfileUser; onChanged: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, startUpload] = useTransition();

  // Object URLs are held by the browser until explicitly released.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const choose = (file: File) => {
    setPreview(URL.createObjectURL(file));

    const body = new FormData();
    body.set("avatar", file);

    startUpload(async () => {
      const result = await uploadAvatar(body);
      if (!result.ok) {
        setPreview(null);
        toast.error(result.error);
        return;
      }
      toast.success("Profile picture updated");
      onChanged();
    });
  };

  const clear = () => {
    startUpload(async () => {
      const result = await removeAvatar();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setPreview(null);
      toast.success("Profile picture removed");
      onChanged();
    });
  };

  const shown = preview ?? user.image;

  return (
    <div className="flex items-center gap-4 rounded-lg border p-3">
      <Avatar
        name={user.name}
        email={user.email}
        src={shown}
        size={64}
        className={cn("rounded-xl", busy && "opacity-60")}
      />

      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium">Profile picture</p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          PNG, JPEG or WebP, up to 1MB. Square images look best.
        </p>

        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) choose(file);
            // Reset so picking the same file twice still fires a change.
            event.target.value = "";
          }}
        />

        <div className="mt-2 flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            <ImageUp className="size-3.5" />
            {busy ? "Working…" : shown ? "Replace" : "Upload"}
          </Button>
          {shown ? (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={clear}>
              <Trash2 className="size-3.5" />
              Remove
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function NameField({ user, onChanged }: { user: ProfileUser; onChanged: () => void }) {
  const [name, setName] = useState(user.name);
  const [saving, startSave] = useTransition();
  const dirty = name.trim() !== user.name;

  const save = () => {
    startSave(async () => {
      const result = await updateDisplayName(name);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Name updated");
      onChanged();
    });
  };

  return (
    <form
      className="space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty) save();
      }}
    >
      <Label htmlFor="profile-name">Display name</Label>
      <div className="flex gap-2">
        <Input
          id="profile-name"
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Shown in the sidebar and on messages you send from the composer.
      </p>
    </form>
  );
}

function PasskeysTab() {
  const router = useRouter();
  const [passkeyName, setPasskeyName] = useState("");
  const [attachment, setAttachment] = useState<"platform" | "cross-platform">("platform");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registering, startRegistration] = useTransition();

  const secureContext = typeof window === "undefined" ? true : window.isSecureContext;

  const addPasskey = () => {
    setError(null);
    setNotice(null);

    startRegistration(async () => {
      const result = await authClient.passkey.addPasskey({
        name: passkeyName.trim() || undefined,
        authenticatorAttachment: attachment,
      });

      if (result.error) {
        setError(result.error.message ?? "Could not register a passkey.");
        return;
      }

      setPasskeyName("");
      setNotice("Passkey added. You can use it for faster sign-in on this device.");
      toast.success("Passkey registered");
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="rounded-lg border p-3">
        <p className="text-[13px] font-medium">Set up faster login</p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Register a passkey on this device, then sign in with your fingerprint, face, or hardware
          key.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="passkey-name">Passkey name (optional)</Label>
        <Input
          id="passkey-name"
          value={passkeyName}
          onChange={(event) => setPasskeyName(event.target.value)}
          placeholder="MacBook Touch ID"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="passkey-device">Preferred device type</Label>
        <select
          id="passkey-device"
          value={attachment}
          onChange={(event) =>
            setAttachment(event.target.value as "platform" | "cross-platform")
          }
          className="flex h-9 w-full rounded-md border bg-card px-2.5 text-[13px] shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25"
        >
          <option value="platform">This device (fingerprint/face unlock)</option>
          <option value="cross-platform">External security key</option>
        </select>
      </div>

      {!secureContext ? (
        <p className="rounded-md border border-signal-warning/40 bg-signal-warning/8 px-2.5 py-2 text-[12px] text-signal-warning">
          Passkeys require HTTPS, except localhost. Open this app on a secure origin to register
          one.
        </p>
      ) : null}

      {notice ? (
        <p className="rounded-md border border-signal-success/40 bg-signal-success/8 px-2.5 py-2 text-[12px] text-signal-success">
          {notice}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/8 px-2.5 py-2 text-[12px] text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="button" onClick={addPasskey} disabled={registering || !secureContext}>
        <Fingerprint className="size-3.5" />
        {registering ? "Waiting for device…" : "Register passkey"}
      </Button>
    </div>
  );
}

/**
 * Everywhere this account is currently signed in.
 *
 * Loaded when the tab is opened rather than with the dialog: it is a database
 * round trip that most visits to Profile never need, and a stale list is worse
 * than a brief spinner — the whole point of the screen is to answer "is that
 * still me?" with something current.
 */
function SessionsTab({ open }: { open: boolean }) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startAction] = useTransition();
  const [reloadKey, setReloadKey] = useState(0);

  /**
   * One place that fetches, re-run by bumping `reloadKey`.
   *
   * The cancellation flag is not ceremony: opening the tab, revoking, and
   * refreshing in quick succession starts overlapping requests, and without
   * it the slowest one wins and puts the row you just ended back on screen.
   */
  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    listActiveSessions().then(
      (rows) => {
        if (cancelled) return;
        setSessions(rows);
        setError(null);
      },
      () => {
        if (!cancelled) setError("Could not load your sessions.");
      },
    );

    return () => {
      cancelled = true;
    };
  }, [open, reloadKey]);

  const reload = () => setReloadKey((key) => key + 1);
  const others = sessions?.filter((item) => !item.current).length ?? 0;

  const end = (item: SessionSummary) => {
    startAction(async () => {
      const result = await revokeSession(item.id);
      if (result.ok) toast.success("Session ended");
      else toast.error(result.error);
      reload();
    });
  };

  const endOthers = () => {
    startAction(async () => {
      const result = await revokeOtherSessions();
      if (result.ok) {
        toast.success(others === 1 ? "Other session ended" : "Other sessions ended");
      } else {
        toast.error(result.error);
      }
      reload();
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium">Where you are signed in</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Ending a session signs that browser out immediately. It does not change your password.
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh sessions"
          disabled={pending}
          onClick={reload}
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/8 px-2.5 py-2 text-[12px] text-destructive">
          {error}
        </p>
      ) : null}

      {sessions === null && !error ? (
        <div className="space-y-2">
          {[0, 1].map((row) => (
            <div key={row} className="h-[62px] animate-pulse rounded-lg border bg-secondary/40" />
          ))}
        </div>
      ) : null}

      {sessions?.length ? (
        <ul className="space-y-2">
          {sessions.map((item) => (
            <li
              key={item.id}
              className={cn(
                "flex items-start gap-3 rounded-lg border p-3",
                item.current && "border-signal-success/40 bg-signal-success/5",
              )}
            >
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-secondary">
                {item.current ? (
                  <ShieldCheck className="size-3.5 text-signal-success" />
                ) : (
                  <Laptop className="size-3.5 text-muted-foreground" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">
                  {item.device ?? "Unknown device"}
                  {item.current ? (
                    <span className="ml-1.5 text-[11px] font-normal text-signal-success">
                      This device
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {item.ipAddress ? `${item.ipAddress} · ` : ""}
                  Last active {formatWhen(item.updatedAt)}
                </p>
                <p className="text-[11px] text-muted-foreground/80">
                  Signed in {formatWhen(item.createdAt)}
                </p>
              </div>

              {item.current ? null : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => end(item)}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  End
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {others > 0 ? (
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={endOthers}>
          <LogOut className="size-3.5" />
          {others === 1 ? "End the other session" : `End all ${others} other sessions`}
        </Button>
      ) : null}

      {sessions?.length === 1 ? (
        <p className="text-[12px] text-muted-foreground">
          This is the only device signed in to this account.
        </p>
      ) : null}
    </div>
  );
}

/**
 * The account screen behind "Profile and security".
 *
 * A dialog rather than a page: none of it is a destination you navigate to, it
 * is something you check and close, and pulling it out of the mailbox to a
 * route would lose whatever thread you were reading.
 */
export function ProfileDialog({
  user,
  open,
  onOpenChange,
  onSignOut,
  signingOut,
}: {
  user: ProfileUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignOut: () => void;
  signingOut: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState("profile");

  const refresh = useCallback(() => router.refresh(), [router]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Profile"
        description="Manage your profile, sign-in methods and active sessions."
        className="sm:w-[min(760px,94vw)]"
      >
        <DialogBody>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="profile">Profile</TabsTrigger>
              <TabsTrigger value="security">Security</TabsTrigger>
              <TabsTrigger value="passkeys">Passkeys</TabsTrigger>
              <TabsTrigger value="sessions">Sessions</TabsTrigger>
            </TabsList>

            <TabsContent value="profile" className="space-y-3">
              <AvatarField user={user} onChanged={refresh} />
              {/* Keyed on the stored name so a rename made elsewhere replaces
                  the field rather than being overwritten by a stale draft. */}
              <NameField key={user.name} user={user} onChanged={refresh} />

              <div className="rounded-lg border p-3">
                <p className="text-[12px] text-muted-foreground">Email</p>
                <p className="mt-0.5 text-[13px] font-medium">{user.email}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  The address identifies this account and cannot be changed here.
                  {user.emailVerified ? null : " It has not been confirmed yet — see Security."}
                </p>
              </div>

              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={onSignOut}
                disabled={signingOut}
              >
                <LogOut className="size-3.5" />
                {signingOut ? "Signing out…" : "Sign out"}
              </Button>
            </TabsContent>

            <TabsContent value="security">
              <SecurityTab
                email={user.email}
                verified={user.emailVerified}
              />
            </TabsContent>

            <TabsContent value="passkeys">
              <PasskeysTab />
            </TabsContent>

            <TabsContent value="sessions">
              <SessionsTab open={open && tab === "sessions"} />
            </TabsContent>
          </Tabs>
        </DialogBody>

        <DialogFooter className="justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
