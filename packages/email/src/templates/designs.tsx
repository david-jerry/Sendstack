import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { BodyHtml, Footer, Logo } from "./parts";
import {
  CANVAS,
  FONT,
  HAIRLINE,
  INK,
  body,
  button,
  container,
  heading,
  paragraph,
  readableOn,
  type Brand,
} from "./theme";

export type TemplateProps = {
  brand: Brand;
  subject: string;
  preheader?: string | null;
  bodyHtml: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  unsubscribeUrl?: string | null;
};

/**
 * `<Preview>` renders the hidden text a client shows beside the subject in the
 * inbox list. Left unset, clients scrape the first words of the body — usually
 * "View this email in your browser" or a stray merge field. It is the second
 * most-read line in any campaign after the subject.
 */
function Shell({
  preheader,
  children,
  background = CANVAS,
}: {
  preheader?: string | null;
  children: React.ReactNode;
  background?: string;
}) {
  return (
    <Html lang="en">
      <Head />
      {preheader ? <Preview>{preheader}</Preview> : null}
      <Body style={{ ...body, backgroundColor: background }}>{children}</Body>
    </Html>
  );
}

/** Centred card, logo, text, one button. The safe default. */
export function SimpleTemplate(props: TemplateProps) {
  const { brand } = props;
  return (
    <Shell preheader={props.preheader}>
      <Container style={container}>
        <Section style={{ padding: "24px 28px 8px" }}>
          <Logo brand={brand} />
        </Section>
        <Section style={{ padding: "8px 28px 4px" }}>
          <Heading style={heading}>{props.subject}</Heading>
          <div style={{ color: INK, fontFamily: FONT, fontSize: "15px", lineHeight: "24px" }}>
            <BodyHtml html={props.bodyHtml} />
          </div>
          {props.ctaUrl && props.ctaLabel ? (
            <Section style={{ padding: "12px 0 8px" }}>
              <Button href={props.ctaUrl} style={button(brand.primaryColor)}>
                {props.ctaLabel}
              </Button>
            </Section>
          ) : null}
        </Section>
        <Footer brand={brand} unsubscribeUrl={props.unsubscribeUrl} />
      </Container>
    </Shell>
  );
}

/** Full-width brand-coloured hero with the headline reversed out of it. */
export function AnnouncementTemplate(props: TemplateProps) {
  const { brand } = props;
  const onBrand = readableOn(brand.primaryColor);
  return (
    <Shell preheader={props.preheader}>
      <Container style={container}>
        <Section
          style={{ backgroundColor: brand.primaryColor, padding: "32px 28px", textAlign: "center" }}
        >
          <Logo brand={brand} align="center" />
          <Heading
            style={{ ...heading, color: onBrand, fontSize: "26px", lineHeight: "34px", margin: "16px 0 0" }}
          >
            {props.subject}
          </Heading>
        </Section>
        <Section style={{ padding: "24px 28px 4px" }}>
          <div style={{ color: INK, fontFamily: FONT, fontSize: "15px", lineHeight: "24px" }}>
            <BodyHtml html={props.bodyHtml} />
          </div>
          {props.ctaUrl && props.ctaLabel ? (
            <Section style={{ padding: "14px 0 6px" }}>
              <Button href={props.ctaUrl} style={button(brand.primaryColor)}>
                {props.ctaLabel}
              </Button>
            </Section>
          ) : null}
        </Section>
        <Footer brand={brand} unsubscribeUrl={props.unsubscribeUrl} />
      </Container>
    </Shell>
  );
}

/** Masthead, rule, content, rule. For a recurring digest. */
export function NewsletterTemplate(props: TemplateProps) {
  const { brand } = props;
  return (
    <Shell preheader={props.preheader}>
      <Container style={container}>
        <Section style={{ padding: "22px 28px 14px" }}>
          <Logo brand={brand} />
        </Section>
        <Hr style={{ borderColor: HAIRLINE, margin: 0 }} />
        <Section style={{ padding: "22px 28px 6px" }}>
          <Text
            style={{
              color: brand.primaryColor,
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              margin: "0 0 8px",
              textTransform: "uppercase",
            }}
          >
            Newsletter
          </Text>
          <Heading style={heading}>{props.subject}</Heading>
          <div style={{ color: INK, fontFamily: FONT, fontSize: "15px", lineHeight: "25px" }}>
            <BodyHtml html={props.bodyHtml} />
          </div>
          {props.ctaUrl && props.ctaLabel ? (
            <Section style={{ padding: "12px 0 8px" }}>
              <Button href={props.ctaUrl} style={button(brand.primaryColor)}>
                {props.ctaLabel}
              </Button>
            </Section>
          ) : null}
        </Section>
        <Hr style={{ borderColor: HAIRLINE, margin: "6px 0 0" }} />
        <Footer brand={brand} unsubscribeUrl={props.unsubscribeUrl} bordered={false} />
      </Container>
    </Shell>
  );
}

/**
 * No card, no logo, no colour.
 *
 * Deliberately the plainest possible markup. Heavy templates correlate with
 * lower inbox placement, and anything meant to read as a message from a person
 * rather than a brand should not arrive wrapped in brand furniture.
 */
export function PlainTemplate(props: TemplateProps) {
  return (
    <Shell preheader={props.preheader} background="#ffffff">
      <Container style={{ margin: "0 auto", maxWidth: "560px", padding: "8px 24px" }}>
        <div style={{ color: INK, fontFamily: FONT, fontSize: "15px", lineHeight: "24px" }}>
          <BodyHtml html={props.bodyHtml} />
        </div>
        {props.ctaUrl && props.ctaLabel ? (
          <Text style={{ ...paragraph, margin: "16px 0" }}>
            <a href={props.ctaUrl} style={{ color: props.brand.primaryColor }}>
              {props.ctaLabel}
            </a>
          </Text>
        ) : null}
        <Footer brand={props.brand} unsubscribeUrl={props.unsubscribeUrl} />
      </Container>
    </Shell>
  );
}

/** Transactional chrome for magic links and other auth mail. */
export function AuthTemplate(props: {
  brand: Brand;
  headingText: string;
  bodyText: string;
  ctaLabel: string;
  ctaUrl: string;
  footer?: string;
}) {
  return (
    <Shell preheader={props.headingText}>
      <Container style={container}>
        <Section style={{ padding: "24px 28px 8px" }}>
          <Logo brand={props.brand} />
        </Section>
        <Section style={{ padding: "8px 28px 20px" }}>
          <Heading style={heading}>{props.headingText}</Heading>
          <Text style={paragraph}>{props.bodyText}</Text>
          <Button href={props.ctaUrl} style={button(props.brand.primaryColor)}>
            {props.ctaLabel}
          </Button>
          {/* Some clients strip buttons, and cautious people want to see where
              a link goes before clicking it. Always show the raw URL too. */}
          <Text style={{ ...paragraph, color: "#71717a", fontSize: "12px", margin: "18px 0 0" }}>
            Or paste this into your browser:
            <br />
            <span style={{ wordBreak: "break-all" }}>{props.ctaUrl}</span>
          </Text>
          {props.footer ? (
            <Text style={{ ...paragraph, color: "#71717a", fontSize: "12px", margin: "12px 0 0" }}>
              {props.footer}
            </Text>
          ) : null}
        </Section>
      </Container>
    </Shell>
  );
}
