import { Hr, Img, Link, Section, Text } from "@react-email/components";
import { HAIRLINE, MUTED, small, type Brand } from "./theme";

/**
 * The logo block.
 *
 * `height` is set and `width` left to `auto` so a wide or tall logo both land
 * at a sane size. The `alt` falls back to the app name, which is what a
 * recipient with images blocked — a large minority, always — actually sees.
 */
export function Logo({ brand, align = "left" }: { brand: Brand; align?: "left" | "center" }) {
  if (!brand.logoUrl) {
    return (
      <Text style={{ color: MUTED, fontSize: "15px", fontWeight: 600, margin: 0, textAlign: align }}>
        {brand.appName}
      </Text>
    );
  }
  return (
    <Img
      src={brand.logoUrl}
      alt={brand.appName}
      height="28"
      style={{ display: "block", height: "28px", width: "auto", margin: align === "center" ? "0 auto" : undefined }}
    />
  );
}

/**
 * The footer, carrying the visible unsubscribe link.
 *
 * This is not decoration and not optional. A visible unsubscribe link plus the
 * List-Unsubscribe headers is what keeps recipients pressing "unsubscribe"
 * instead of "report spam" — and a spam complaint costs a sender far more than
 * an unsubscribe does.
 */
export function Footer({
  brand,
  unsubscribeUrl,
  bordered = true,
}: {
  brand: Brand;
  unsubscribeUrl?: string | null;
  bordered?: boolean;
}) {
  return (
    <Section style={{ padding: "16px 28px 24px" }}>
      {bordered ? <Hr style={{ borderColor: HAIRLINE, margin: "0 0 14px" }} /> : null}
      <Text style={small}>
        Sent by {brand.appName}.{" "}
        {unsubscribeUrl ? (
          <>
            <Link href={unsubscribeUrl} style={{ color: MUTED, textDecoration: "underline" }}>
              Unsubscribe
            </Link>{" "}
            at any time.
          </>
        ) : null}
      </Text>
      {/* Below the unsubscribe line, not above it: the address is a legal
          requirement and a trust signal, but it is not what someone scanning
          the footer is looking for. */}
      {brand.postalAddress ? (
        <Text style={{ ...small, marginTop: "6px", whiteSpace: "pre-line" }}>
          {brand.postalAddress}
        </Text>
      ) : null}
    </Section>
  );
}

/**
 * Campaign body HTML, injected as-is.
 *
 * Safe because this content is authored inside Sendstack by an authenticated
 * operator — unlike inbound mail, which is never rendered. Merge fields have
 * already been escaped by `renderTemplate` before reaching here.
 */
export function BodyHtml({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
