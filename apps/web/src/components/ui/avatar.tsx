import { avatarHue, cn, initials } from "@/lib/utils";

/**
 * A person, as a small square.
 *
 * With no picture it is a deterministic identicon: the hue derives from the
 * address, so the same person is the same colour on every screen and across
 * every session without storing an image or a preference.
 *
 * With one, the initials stay underneath rather than being replaced. That is
 * what the viewer sees while the image is still loading, and what they keep
 * seeing if it never arrives — a broken-image glyph in a 28px circle is worse
 * than the letters it displaced.
 */
export function Avatar({
  name,
  email,
  src,
  size = 28,
  className,
}: {
  name?: string | null;
  email?: string;
  /** A profile picture. Falls back to initials when absent or unloadable. */
  src?: string | null;
  size?: number;
  className?: string;
}) {
  const seed = email ?? name ?? "?";
  const hue = avatarHue(seed);
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-medium select-none",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.38)),
        backgroundColor: `oklch(0.93 0.06 ${hue})`,
        color: `oklch(0.42 0.15 ${hue})`,
      }}
    >
      {initials(name, email)}
      {src ? (
        /*
         * Not next/image: the href may point at a Cloudinary account nobody
         * knew about at build time, and optimising a 28px square is not worth
         * whitelisting every possible remote host.
         *
         * No `onError` handler either — this renders from Server Components
         * too, where a function prop is a render-time throw. An empty `alt`
         * already means a failed load paints nothing, so the initials
         * underneath simply stay visible.
         */
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="absolute inset-0 size-full object-cover" />
      ) : null}
    </span>
  );
}
