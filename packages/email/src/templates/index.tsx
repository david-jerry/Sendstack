import { render } from "@react-email/render";
import { absoluteBrandingUrl, brandingRefs, getConfig } from "@sendstack/config";
import { db, eq } from "@sendstack/db";
import { templates } from "@sendstack/db/schema";
import { TEMPLATE_META, type TemplateKind } from "@sendstack/shared";
import type { MergeContext } from "../render";
import { renderCustomTemplate } from "./custom";
import {
  AnnouncementTemplate,
  AuthTemplate,
  NewsletterTemplate,
  PlainTemplate,
  SimpleTemplate,
  type TemplateProps,
} from "./designs";
import type { Brand } from "./theme";

/**
 * Re-exported so server code has one import for rendering and its metadata.
 * The definitions live in `@sendstack/shared` because client components need
 * them too, and importing this module from the browser would drag the
 * renderer's server dependencies along with it.
 */
export { TEMPLATE_META, type TemplateKind };

const COMPONENTS = {
  simple: SimpleTemplate,
  announcement: AnnouncementTemplate,
  newsletter: NewsletterTemplate,
  plain: PlainTemplate,
} as const;

/** The brand block every template needs, assembled from stored settings. */
export async function currentBrand(): Promise<Brand> {
  const [config, refs] = await Promise.all([getConfig(), brandingRefs()]);
  return {
    appName: config.appName,
    appUrl: config.appUrl,
    primaryColor: config.primaryColor,
    // Always absolute: a Cloudinary href already is, a database-backed one has
    // to be joined to the app URL or the image silently breaks in every inbox.
    logoUrl: absoluteBrandingUrl(config.appUrl, refs.logo),
    postalAddress: config.postalAddress,
  };
}

export type RenderCampaignInput = Omit<TemplateProps, "brand"> & {
  brand?: Brand;
  template?: TemplateKind;
  /**
   * An uploaded template's HTML, which wins over `template` when present.
   *
   * The HTML rather than an id: the send job loads it once per run and passes
   * it for every recipient, exactly as it does the brand, so this function
   * never has to touch the database inside a 2,500-message loop.
   */
  customTemplateHtml?: string | null;
  /** Recipient fields, so an uploaded template can personalise its own chrome. */
  context?: MergeContext;
};

/**
 * The stored HTML of an uploaded template, or null when it no longer exists.
 *
 * One column, one row, by primary key. Every reader — the send job, the
 * compose and campaign actions, the preview route — goes through here and
 * gets a null rather than a throw for a deleted template. What each does with
 * the null is its own call: the send job falls back to the built-in design so
 * the campaign still goes out, the actions refuse with a sentence because a
 * person is looking, and the preview route answers 404.
 */
export async function customTemplateHtml(id: string): Promise<string | null> {
  const [row] = await db
    .select({ html: templates.html })
    .from(templates)
    .where(eq(templates.id, id))
    .limit(1);
  return row?.html ?? null;
}

/**
 * Wrap a campaign body in the chosen template and produce both parts.
 *
 * Templates supply the chrome; `bodyHtml` is the operator's content with merge
 * fields already substituted and escaped. Returning `text` alongside `html` is
 * not optional — a message with no plain-text alternative is scored as more
 * likely to be spam by essentially every filter.
 */
export async function renderCampaignEmail(
  input: RenderCampaignInput,
): Promise<{ html: string; text: string }> {
  // Only consult settings for what the caller did not supply. The send job
  // resolves the brand once per run and passes it for every message, so this
  // path must not force a settings read per recipient — and it makes the
  // renderer usable, and testable, without a database at all.
  const brand = input.brand ?? (await currentBrand());

  // An uploaded template is plain HTML with slots, not a component, so it has
  // its own renderer — but it takes the same props and returns the same pair,
  // which is what lets every caller stay ignorant of which kind it got.
  if (input.customTemplateHtml) {
    const { customTemplateHtml: html, context, template: _kind, ...props } = input;
    return renderCustomTemplate(html, { ...props, brand }, context);
  }

  const kind = input.template ?? (await getConfig()).emailTemplate;
  const Component = COMPONENTS[kind] ?? SimpleTemplate;

  const element = <Component {...input} brand={brand} />;
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return { html, text };
}

export async function renderAuthEmail(input: {
  heading: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  footer?: string;
  brand?: Brand;
}): Promise<string> {
  const brand = input.brand ?? (await currentBrand());
  return render(
    <AuthTemplate
      brand={brand}
      headingText={input.heading}
      bodyText={input.body}
      ctaLabel={input.ctaLabel}
      ctaUrl={input.ctaUrl}
      {...(input.footer ? { footer: input.footer } : {})}
    />,
  );
}

/**
 * A self-contained sample for the template pickers, using placeholder copy so
 * the preview works before any campaign exists.
 *
 * Takes either a built-in kind or an uploaded template's HTML, so the settings
 * grid and the Design picker show both through one route and one sample — a
 * custom template previewed with different copy from the built-ins would be
 * impossible to compare against them.
 */
export async function renderTemplatePreview(
  design: TemplateKind | { html: string },
  brand?: Brand,
): Promise<string> {
  const resolved = brand ?? (await currentBrand());
  const sample: TemplateProps = {
    brand: resolved,
    subject: "Your February update is here",
    preheader: "Three things we shipped this month.",
    bodyHtml: `<p>Hi Ada,</p><p>Here is what changed this month, and one thing we would love your opinion on.</p><ul><li>Faster imports</li><li>Reply threading</li><li>A suppression list you can actually audit</li></ul>`,
    ctaLabel: "Read the update",
    ctaUrl: `${resolved.appUrl}/`,
    unsubscribeUrl: `${resolved.appUrl}/unsubscribe`,
  };

  if (typeof design === "object") {
    return renderCustomTemplate(design.html, sample, { firstName: "Ada" }).html;
  }
  const Component = COMPONENTS[design] ?? SimpleTemplate;
  return render(<Component {...sample} />);
}

export type { Brand } from "./theme";
export type { TemplateProps } from "./designs";
