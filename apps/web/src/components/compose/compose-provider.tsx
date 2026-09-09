"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { ComposeDialog } from "./compose-dialog";

const ComposeContext = createContext<{ openCompose: () => void } | null>(null);

/**
 * Owns the compose dialog, once, above every button that opens it.
 *
 * The dialog used to be rendered by the button. On desktop that was fine; on a
 * phone the button lives inside the navigation drawer, so opening the composer
 * closed the drawer, the drawer unmounted its children, and the dialog it had
 * just rendered went with them — the modal appeared and vanished in the same
 * frame. Hoisting it here also means one dialog instead of one per rail (the
 * rail renders twice, docked and in the drawer).
 */
export function ComposeProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openCompose = useCallback(() => setOpen(true), []);
  const value = useMemo(() => ({ openCompose }), [openCompose]);

  return (
    <ComposeContext.Provider value={value}>
      {children}
      <ComposeDialog open={open} onOpenChange={setOpen} />
    </ComposeContext.Provider>
  );
}

export function useCompose() {
  const context = useContext(ComposeContext);
  if (!context) {
    throw new Error("useCompose must be used inside a ComposeProvider");
  }
  return context;
}
