import type { RealtimeEventType } from "@sendstack/shared";

/**
 * TanStack Query keys shared between components that do not otherwise import
 * each other.
 *
 * The compose dialog's Design picker reads the uploaded-template list, and the
 * settings section that uploads and deletes templates has to invalidate it.
 * Importing the key from the picker component would pull that component —
 * and the popover it renders — into the settings bundle for one constant.
 */
export const CUSTOM_TEMPLATES_QUERY_KEY = ["custom-templates"] as const;


/**
 * Which cached lists each realtime event invalidates.
 *
 * The gap this closes: every mailbox is a `useCursorList`, which is a
 * TanStack `useInfiniteQuery` seeded from the server's first page. A realtime
 * event nudged the Zustand store and scheduled `router.refresh()` — and the
 * refresh re-rendered the Server Component perfectly, handing the panel a new
 * `initialPage` prop that React Query then **ignored**, because `initialData`
 * is only consulted while the cache is empty. So mail arrived, the unread
 * badge moved, and the list under it did not change for `staleTime` — thirty
 * seconds, or until the reader navigated. The badge and the list were reading
 * two different stores and only one of them was being told.
 *
 * Declared here, keyed by event type, rather than as an `invalidateQueries`
 * call inside the SSE handler: the keys belong to the panels, the events
 * belong to the contract, and this table is the one place the two are matched
 * up. A panel that adds a list adds a row here; a new event type that touches
 * no list maps to nothing and costs no refetch.
 *
 * Prefixes, not whole keys. `useCursorList` appends its serialised search
 * params to the key it is given, so `["threads"]` matches every folder, every
 * filter and every search that is currently mounted — which is what should
 * happen, since an arriving message can belong to any of them.
 */
export const REALTIME_INVALIDATIONS: Record<RealtimeEventType, readonly (readonly string[])[]> = {
  "inbound.received": [["threads"]],
  "inbound.updated": [["threads"]],
  /**
   * Both, deliberately. A delivery event moves a row in the Sent list, and it
   * also moves the outbound message rendered inside a *thread* — the two
   * halves of one conversation live in two different queries.
   */
  "outbound.updated": [["outbound"], ["threads"]],
  "campaign.progress": [["campaigns"]],
  /**
   * A suppression can be added by a bounce on a contact, so the contact list
   * can be showing a status that is no longer true.
   */
  "suppression.added": [["contacts"]],
  /**
   * Nothing. Account changes render from the bell's own store and its
   * server-rendered seed; no cursor list holds them, and invalidating one to
   * be safe would refetch a mailbox every time a Resend contact was edited.
   */
  "account.activity": [],
};
