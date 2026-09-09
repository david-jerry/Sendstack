import { MailboxSkeleton } from "@/components/shell/skeletons";

/**
 * The mail routes' loading state.
 *
 * This used to be the splash screen, and the splash was wrong here for a
 * reason worth writing down: by the time this boundary is reached the sidebar,
 * the folder counts and the user menu are already on screen. Telling someone
 * the app is "loading your mailbox" while they are looking at their mailbox
 * reads as a stall, and a `min-h-dvh` centred column inside the shell's flex
 * row drew it as a narrow strip beside an empty page.
 *
 * A mailbox skeleton instead, because this boundary now covers exactly the
 * mail routes and nothing else. Everything else under `(app)` has a
 * `loading.tsx` of its own and a nested one always wins: `contacts`, `lists`,
 * `suppressions`, `campaigns` and `settings` each draw their own shape, and
 * each thread reader draws its own under `[id]`. What falls through to here is
 * `/inbox`, `/starred`, `/sent`, `/drafts`, `/archive` and `/spam` — six
 * routes with one shape.
 *
 * The reason those six cannot have their own file: a segment's `loading.tsx`
 * renders *inside* that segment's layout, and their layout is the thing that
 * draws the list column. A `loading.tsx` there would appear in the reader slot
 * beside a list that has not arrived, which is the opposite of the problem
 * being solved. The list's own fetch is handled by a `Suspense` inside each
 * layout; this file covers the wait for the layout itself.
 */
export default function AppLoading() {
  return <MailboxSkeleton />;
}
