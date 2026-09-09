"use client";

import { createContext, useCallback, useContext, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "@sendstack/auth/client";
import { toast } from "sonner";
import { ProfileDialog, type ProfileUser } from "@/components/shell/profile-dialog";
import { purgeCachedMail } from "@/lib/freshness";

type ProfileContextValue = {
  openProfile: () => void;
  signOutNow: () => void;
  signingOut: boolean;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

/**
 * Owns the profile dialog, once, above every button that opens it.
 *
 * The dialog used to be rendered by `NavUser`. On desktop that was fine; on a
 * phone the account row lives inside the navigation drawer, so opening the
 * dialog closed the drawer, the drawer unmounted its children, and the dialog
 * it had just rendered went with them — the modal appeared and vanished in the
 * same frame. Exactly the bug `ComposeProvider` exists to fix, in exactly the
 * same place, which is why the fix is the same shape.
 *
 * Signing out lives here too. The account menu and the dialog's own Account
 * tab both offer it, and two copies of a transition that redirects is two
 * places for the pending label to be wrong.
 */
export function ProfileProvider({
  user,
  children,
}: {
  user: ProfileUser;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, startSignOut] = useTransition();

  const openProfile = useCallback(() => setOpen(true), []);

  const signOutNow = useCallback(() => {
    startSignOut(async () => {
      const result = await signOut();
      if (result.error) {
        toast.error(result.error.message ?? "Could not sign out right now.");
        return;
      }
      /**
       * Before navigating away: the service worker holds rendered mailbox
       * pages and list responses so the app works offline, and none of that
       * should survive the session that was allowed to see it.
       */
      purgeCachedMail();
      setOpen(false);
      router.push("/sign-in");
      router.refresh();
    });
  }, [router]);

  const value = useMemo(
    () => ({ openProfile, signOutNow, signingOut }),
    [openProfile, signOutNow, signingOut],
  );

  return (
    <ProfileContext.Provider value={value}>
      {children}
      <ProfileDialog
        user={user}
        open={open}
        onOpenChange={setOpen}
        onSignOut={signOutNow}
        signingOut={signingOut}
      />
    </ProfileContext.Provider>
  );
}

export function useProfile(): ProfileContextValue {
  const context = useContext(ProfileContext);
  if (!context) {
    throw new Error("useProfile must be used inside a ProfileProvider");
  }
  return context;
}
