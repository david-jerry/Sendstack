"use client";

import { create } from "zustand";

/**
 * Whether the details drawer is open.
 *
 * ## Why a store and not a Context provider
 *
 * The trigger and the drawer live in different subtrees. The triggers sit
 * inside the composer, deep in `ThreadView`; the drawer is a *sibling* of the
 * reader column. Two components in different subtrees cannot share a
 * `useState`, which is the reason the trigger used to be `position: fixed`.
 *
 * The first attempt at fixing that was a `DetailsProvider` wrapping both
 * columns — and it wrapped them from inside `thread-page-content.tsx`, which
 * is a **Server Component**. That put a client Context boundary at the top of
 * a server-rendered tree, and the thread reader started failing to hydrate
 * with:
 *
 *     Element type is invalid. Received a promise that resolves to: undefined.
 *     Lazy element type must resolve to a class or function.
 *
 * A store needs no provider, so the server tree keeps the shape it had before:
 * `<Panel>` and `<DetailsPanel>` as plain siblings, with no client component
 * wrapping server children. It is also the pattern this codebase already uses
 * twice — see `realtime-store` and `connectivity-store` — and one fewer
 * concept than a bespoke context.
 *
 * What a store gives up is *scoping*: every drawer on a page would share this
 * state. There is exactly one per screen, so nothing is given up in practice.
 * If a second ever appears on the same route, that is the moment to reach for
 * a provider again — and to put it in a Client Component.
 */
type DetailsState = {
  /** Meaningless above the `lg` breakpoint, where the panel is a column. */
  open: boolean;
  openDetails: () => void;
  closeDetails: () => void;
  setOpen: (open: boolean) => void;
};

export const useDetailsStore = create<DetailsState>((set) => ({
  open: false,
  openDetails: () => set({ open: true }),
  closeDetails: () => set({ open: false }),
  setOpen: (open) => set({ open }),
}));
