import { z } from "zod";
import {
  AUTH_SECRET_MIN_LENGTH,
  DEFAULT_BRAND_COLOR,
  HEX_COLOR_PATTERN,
  MIN_PASSWORD_LENGTH,
} from "./constants";
import { isLikelyValidEmail, normalizeEmail } from "./email-address";
import { SUPPRESSION_REASONS } from "./enums";
import { TEMPLATE_KINDS } from "./templates";
import {
  CUSTOM_TEMPLATE_DESCRIPTION_MAX,
  CUSTOM_TEMPLATE_NAME_MAX,
  parseTemplateRef,
  validateCustomTemplate,
} from "./custom-templates";
import { absoluteUrl, normalizeName } from "./text";

/**
 * One definition per shape, used by both the React Hook Form resolver and the
 * Server Action that receives the result. The client copy is a convenience;
 * the server copy is the one that matters, and it never trusts the client's.
 */

/** An address that is trimmed, lowercased and syntactically plausible. */
export const emailField = z
  .string()
  .min(1, "Email is required")
  .transform(normalizeEmail)
  .refine(isLikelyValidEmail, "That does not look like a valid email address");

/**
 * An address that may be blank, but never malformed.
 *
 * `emailField.optional().or(z.literal(""))` is the shape reached for first and
 * it answers a different question: the union's right branch matches the *raw*
 * value, so a field holding a single space satisfies neither branch and is
 * reported as an invalid address rather than as empty. Normalising before the
 * decision makes "cleared" and "blank" the same instruction.
 *
 * This distinction is the whole point for a sender address. Clearing it is a
 * legitimate thing to ask for — Settings offers it — while mistyping it is
 * not, and a schema that simply drops the field to make clearing expressible
 * takes the syntax check with it. That is how `weird thing@mail.example.com`
 * came to be storable: it fails no `endsWith` test and only surfaces as an
 * opaque provider rejection at the first send.
 */
export const optionalEmailField = z
  .string()
  .transform(normalizeEmail)
  .refine(
    (value) => value.length === 0 || isLikelyValidEmail(value),
    "That does not look like a valid email address",
  );

export const contactInputSchema = z.object({
  email: emailField,
  firstName: z.string().trim().max(120).optional().or(z.literal("")),
  lastName: z.string().trim().max(120).optional().or(z.literal("")),
  company: z.string().trim().max(160).optional().or(z.literal("")),
  position: z.string().trim().max(160).optional().or(z.literal("")),
  phone: z
    .string()
    .trim()
    .max(20)
    .optional()
    .or(z.literal(""))
    .refine(
      (value) => !value || /^\+[1-9]\d{1,14}$/.test(value),
      "Use E.164 format, e.g. +14155552671",
    ),
  attributes: z.record(z.string(), z.unknown()).default({}),
  listIds: z.array(z.uuid()).default([]),
  groupIds: z.array(z.uuid()).default([]),
});
export type ContactInput = z.infer<typeof contactInputSchema>;

export const contactGroupInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
});
export type ContactGroupInput = z.infer<typeof contactGroupInputSchema>;

export const listInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
});
export type ListInput = z.infer<typeof listInputSchema>;

export const campaignInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(160),
  subject: z.string().trim().min(1, "Subject is required").max(200),
  preheader: z.string().trim().max(200).optional().or(z.literal("")),
  fromName: z.string().trim().min(1, "From name is required").max(120),
  fromEmail: emailField,
  replyTo: emailField.optional().or(z.literal("")),
  html: z.string().min(1, "Body is required"),
  text: z.string().optional().or(z.literal("")),
  listId: z.uuid().nullable().default(null),
  /** Which design wraps the body. Null falls back to the instance default. */
  emailTemplate: z.enum(TEMPLATE_KINDS).nullable().default(null),
  /** An uploaded template by id. Takes precedence over `emailTemplate` when set. */
  customTemplateId: z.uuid().nullable().default(null),
});
export type CampaignInput = z.infer<typeof campaignInputSchema>;

// ─── Templates ───────────────────────────────────────────────────────────────

/**
 * A design reference as the browser sends it: a built-in kind or `custom:<id>`.
 *
 * Refined through `parseTemplateRef` rather than re-listing the kinds here, so
 * the offline send route, the compose action and the picker accept exactly the
 * set the renderer can produce. The route used to carry its own copy of the
 * four names; a fifth would have had to be added in two places.
 */
export const templateRefSchema = z
  .string()
  .refine((value) => parseTemplateRef(value) !== null, "Unknown template");

/**
 * An uploaded template, as the settings form and its Server Action see it.
 *
 * The HTML is validated by the same `validateCustomTemplate` the renderer's
 * contract is defined by. Only the first problem is surfaced through Zod — the
 * form shows the full list separately, because "add {{{ body }}}" and "remove
 * the <script>" are both worth fixing before a second round trip.
 */
export const customTemplateInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name the template")
    .max(CUSTOM_TEMPLATE_NAME_MAX, `Keep the name under ${CUSTOM_TEMPLATE_NAME_MAX} characters`),
  description: z
    .string()
    .trim()
    .max(CUSTOM_TEMPLATE_DESCRIPTION_MAX, "That description is very long")
    .optional()
    .or(z.literal("")),
  html: z
    .string()
    .min(1, "Paste or upload the template HTML")
    .superRefine((value, ctx) => {
      const check = validateCustomTemplate(value);
      if (!check.ok) ctx.addIssue({ code: "custom", message: check.errors[0]! });
    }),
});
export type CustomTemplateInput = z.infer<typeof customTemplateInputSchema>;

/**
 * The campaign form, as the browser holds it.
 *
 * Narrower than `campaignInputSchema`: the sender is read from settings on the
 * server rather than typed, because a from-address that is not on the verified
 * domain is rejected by the provider and there is nothing useful a person can
 * do with that error in a create dialog.
 */
export const campaignFormSchema = z.object({
  name: z.string().trim().min(1, "Name the campaign").max(160),
  subject: z.string().trim().min(1, "Add a subject").max(200, "That subject is very long"),
  preheader: z.string().trim().max(200).optional().or(z.literal("")),
  html: z.string().min(1, "Write the message"),
  listId: z.string().min(1, "Choose who this goes to"),
});
export type CampaignFormInput = z.infer<typeof campaignFormSchema>;

export const addToListSchema = z.object({
  listId: z.uuid(),
  contactIds: z.array(z.uuid()).min(1, "Choose at least one contact"),
});
export type AddToListInput = z.infer<typeof addToListSchema>;

export const scheduleCampaignSchema = z
  .object({
    campaignId: z.uuid(),
    /** ISO 8601. Omit to send immediately. */
    scheduledAt: z.iso.datetime({ offset: true }).nullable().default(null),
  })
  .refine(
    (value) => value.scheduledAt === null || new Date(value.scheduledAt).getTime() > Date.now(),
    { message: "Scheduled time must be in the future", path: ["scheduledAt"] },
  );
export type ScheduleCampaignInput = z.infer<typeof scheduleCampaignSchema>;

export const suppressionInputSchema = z.object({
  email: emailField,
  reason: z.enum(SUPPRESSION_REASONS).default("manual"),
  detail: z.string().trim().max(500).optional().or(z.literal("")),
});
export type SuppressionInput = z.infer<typeof suppressionInputSchema>;

/**
 * CSV import. Rows are validated one at a time and bad rows are *reported*,
 * never silently skipped — an import that quietly drops 400 of 1,000 rows is
 * how a campaign goes out to the wrong audience.
 */
export const importRowSchema = z.object({
  email: emailField,
  firstName: z.string().trim().max(120).optional(),
  lastName: z.string().trim().max(120).optional(),
});
export type ImportRow = z.infer<typeof importRowSchema>;

/**
 * The one rule for a new password, in one place.
 *
 * `MIN_PASSWORD_LENGTH` is also what Better Auth's `minPasswordLength` reads,
 * so the form and the server cannot disagree about it. Every password field
 * in this file is this one; the sign-up and admin-account schemas used to
 * carry their own copies.
 */
export const newPasswordField = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(256, "That is longer than 256 characters");

export const signUpSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: emailField,
  password: newPasswordField,
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Password is required"),
});
export type SignInInput = z.infer<typeof signInSchema>;


/** Asking for a reset link. Only the address, and it is never confirmed back. */
export const forgotPasswordSchema = z.object({ email: emailField });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/**
 * Choosing a new password from a reset link.
 *
 * The confirmation field is not ceremony: this form is reached from an email,
 * often on a phone, by somebody who has just proved they cannot remember the
 * old password. A typo they cannot see would lock them out of the account they
 * came here to recover.
 */
export const resetPasswordSchema = z
  .object({
    password: newPasswordField,
    confirm: z.string().min(1, "Type it again to confirm"),
  })
  .refine((values) => values.password === values.confirm, {
    message: "Those two passwords do not match",
    path: ["confirm"],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * Changing a password while signed in.
 *
 * The current password is required by Better Auth and is the point: a session
 * left open on a shared machine should not be enough to take the account over.
 * The new one is also refused if it matches the old, which otherwise silently
 * succeeds and revokes every other session for no benefit.
 */
export const changePasswordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password"),
    password: newPasswordField,
    confirm: z.string().min(1, "Type it again to confirm"),
  })
  .refine((values) => values.password === values.confirm, {
    message: "Those two passwords do not match",
    path: ["confirm"],
  })
  .refine((values) => values.password !== values.current, {
    message: "That is the password you already have",
    path: ["password"],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const replySchema = z.object({
  inboundEmailId: z.uuid(),
  body: z.string().trim().min(1, "Write something before sending"),
});
export type ReplyInput = z.infer<typeof replySchema>;

// ─── Composing new mail ──────────────────────────────────────────────────────

/**
 * A field holding several addresses: "a@x.com, b@y.com" or one per line.
 *
 * Validated as a whole rather than split into repeatable rows, because
 * addresses are pasted far more often than typed one at a time, and a paste of
 * six should not become six form rows to fix individually.
 *
 * It refines rather than transforms so the parsed and unparsed shapes stay
 * identical. The form keeps the text the user typed, the Server Action does
 * the splitting on its own — and neither has to reason about whether the value
 * in hand is still a string.
 */
const addressList = (label: string, { required = false } = {}) =>
  z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      const addresses = splitAddressList(value);
      if (required && addresses.length === 0) {
        ctx.addIssue({ code: "custom", message: `${label} is required` });
        return;
      }
      // Name the offending address. "Invalid email" against a field holding
      // nine of them says nothing about which one to fix.
      const bad = addresses.find((address) => !isLikelyValidEmail(address));
      if (bad) ctx.addIssue({ code: "custom", message: `${bad} is not a valid address` });
    });

/** Split "a@x.com, b@y.com" — commas, semicolons or newlines — and normalise. */
export function splitAddressList(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map(normalizeEmail);
}

export const composeSingleSchema = z.object({
  to: addressList("A recipient", { required: true }),
  cc: addressList("Cc"),
  bcc: addressList("Bcc"),
  subject: z.string().trim().min(1, "Add a subject").max(200, "That subject is very long"),
  html: z.string().min(1, "Write something before sending"),
});
export type ComposeSingleInput = z.infer<typeof composeSingleSchema>;

/**
 * A single send as it travels over `fetch` — the composer's fields plus what
 * the offline outbox needs to replay it.
 *
 * Declared here rather than in the route because two sides read it: the route
 * validates an incoming body against it and `queueSend` in the browser builds
 * the body it stores in IndexedDB. Those were a hand-typed object and a local
 * Zod schema respectively, and the type said `template?: string` while the
 * schema refused anything but a real reference. `QueueableSend` is the *input*
 * type on purpose: it describes what the browser hands over before parsing.
 *
 * `clientKey` is the idempotency identity of a queued send. The browser mints
 * it once, when the request is queued, so however many times the worker
 * replays the body — a network error can hide a response that did arrive —
 * every attempt lands on the same `outbound_messages` row and the same
 * provider key. The server used to derive the key from a row id it minted
 * itself, which made every replay a new row and a new message.
 */
export const composeSendSchema = composeSingleSchema.extend({
  draftId: z.uuid().optional(),
  text: z.string().max(200_000).optional(),
  // The shared schema, not a re-listed enum: an uploaded template arrives here
  // as `custom:<id>`, and a copy of the four built-in names would have refused it.
  template: templateRefSchema.optional(),
  clientKey: z.uuid().optional(),
});
export type QueueableSend = z.input<typeof composeSendSchema>;

export const composeBulkSchema = z.object({
  /** Names the send in Campaigns. Defaults to the subject when left blank. */
  name: z.string().trim().max(160).optional(),
  subject: z.string().trim().min(1, "Add a subject").max(200, "That subject is very long"),
  html: z.string().min(1, "Write something before sending"),
  recipients: z.string().trim().min(1, "Add recipients, or import a CSV"),
});
export type ComposeBulkInput = z.infer<typeof composeBulkSchema>;

// ─── Setup wizard ────────────────────────────────────────────────────────────
//
// One schema per step, used by the React Hook Form resolver *and* by the Server
// Action that receives the result. The client copy is a convenience; the server
// copy is the one that matters, and it never trusts the client's.
//
// The cross-field rules below are the reason this is worth doing rather than
// validating inline: "the from-address must be at your sending domain" and
// "an https:// Redis URL needs a token" were server-only checks, so the first
// time anyone learned about them was a round trip and an error banner.

/**
 * A name field, title-cased and whitespace-collapsed on the way in.
 *
 * It said this already and did not do it. `normalizeName` was applied *after*
 * parsing, in four places — `saveEmailConfig`, `updateEmailSettings`,
 * `saveBranding` and `updateBranding` — so the schema validated one value and
 * the database stored another, and the admin account's name (which uses this
 * field and had no post-parse call) was stored exactly as typed. Three
 * behaviours from one field definition.
 *
 * The transform runs after `max`, so the limit applies to what the user typed
 * rather than to what casing produced; collapsing whitespace can only shorten
 * it, never push a passing value over.
 */
export const nameField = (label: string, max = 120) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`)
    .transform(normalizeName);

export const bootstrapSchema = z.object({
  databaseUrl: z
    .string()
    .trim()
    .min(1, "A connection string is required")
    .refine(
      (value) => /^postgres(ql)?:\/\//i.test(value),
      "That should start with postgresql:// — copy it from your database provider.",
    ),
  authSecret: z
    .string()
    .trim()
    .min(
      AUTH_SECRET_MIN_LENGTH,
      `Use at least ${AUTH_SECRET_MIN_LENGTH} characters. Press Generate to make one.`,
    ),
});
export type BootstrapInput = z.infer<typeof bootstrapSchema>;

const optionalText = z.string().trim().optional().or(z.literal(""));

export const brandingFormSchema = z
  .object({
    appName: nameField("A workspace name", 60),
    /**
     * The trailing slash is stripped **here**, not at the two call sites.
     *
     * Every absolute link this instance emits is built by concatenating a path
     * onto this value — unsubscribe URLs, the logo in an email, attachment
     * URLs, auth callbacks — so a stored `https://mail.example.com/` produces
     * `//unsubscribe`. Both Server Actions carried their own
     * `replace(/\/$/, "")` and the schema carried none, which meant the form
     * validated a value neither of them stored.
     *
     * `absoluteUrl` is that rule, and it is shared with the six places that
     * build a link from this value — five of which stripped a single slash and
     * so left the second one behind.
     */
    appUrl: z
      .string()
      .trim()
      .min(1, "An app URL is required")
      .refine(
        (value) => /^https?:\/\//i.test(value),
        "Must start with http:// or https:// — this is where your instance is reachable.",
      )
      .transform((value) => absoluteUrl(value)),
    primaryColor: z
      .string()
      .trim()
      .regex(HEX_COLOR_PATTERN, `Use a six-digit hex value, like ${DEFAULT_BRAND_COLOR}`),
    cloudinaryCloudName: optionalText,
    cloudinaryApiKey: optionalText,
    cloudinaryApiSecret: optionalText,
    cloudinaryFolder: optionalText,
  })
  .superRefine((value, ctx) => {
    // A key or secret with no cloud name cannot upload anything, and is far
    // more likely a half-filled form than an intent to configure.
    const hasSecrets = Boolean(value.cloudinaryApiKey || value.cloudinaryApiSecret);
    if (hasSecrets && !value.cloudinaryCloudName) {
      ctx.addIssue({
        code: "custom",
        path: ["cloudinaryCloudName"],
        message: "Add your cloud name as well, or clear the key and secret.",
      });
    }
  });
export type BrandingFormInput = z.infer<typeof brandingFormSchema>;

/**
 * How this instance sends mail: the wizard's Email step *and* Settings → Email.
 *
 * One schema for both, and the reason is a bug rather than tidiness. The rule
 * existed four times — here, in `saveEmailConfig`, in `updateEmailSettings`
 * and (as a report) in `deliverability.ts` — and the copies had already
 * drifted apart: the wizard rejected a syntactically invalid from-address and
 * Settings did not check the syntax at all, so `weird thing@mail.example.com`
 * was storable there. Nothing downstream caught it, because the deliverability
 * check only asks whether the address *ends with* the sending domain.
 *
 * The two surfaces differ in which fields they send, not in what is legal:
 * the wizard has no postal address or send rate, so those are optional and an
 * absent one leaves the stored value alone.
 */
export const emailConfigSchema = z
  .object({
    apiKey: optionalText,
    domain: z
      .string()
      .trim()
      .min(1, "A sending domain is required")
      .regex(/^[^@\s]+\.[^@\s]+$/, "That does not look like a domain, e.g. mail.example.com"),
    /** Blank is "clear the sender", which Settings allows. Malformed is not. */
    fromEmail: optionalEmailField,
    fromName: nameField("A from name", 120),
    webhookSecret: optionalText,
    /**
     * Printed in campaign footers, so newlines survive — see the collapsing in
     * `updateEmailSettings`. Only Settings sends it.
     */
    postalAddress: optionalText,
    /**
     * Sends per second, when Settings sends it at all.
     *
     * The bound is here rather than in the action because it is the same rule
     * the form needs: 1 is the floor a send loop can honour and 1000 is far
     * above any Resend plan, so a value outside it is a typo or a probe, and
     * either way it would be written to a `not null integer` column the send
     * job then divides by.
     */
    ratePerSecond: z
      .number()
      .int("The send rate must be a whole number.")
      .min(1, "The send rate must be between 1 and 1000 per second.")
      .max(1000, "The send rate must be between 1 and 1000 per second.")
      .optional(),
    /**
     * Set when a key is already stored, so a blank field is allowed.
     *
     * Required rather than `.default(false)`: a Zod default makes the schema's
     * input and output types diverge, which React Hook Form's single type
     * parameter cannot express. The form always supplies it.
     */
    hasStoredKey: z.boolean(),
  })
  .superRefine((value, ctx) => {
    // Resend rejects a mismatch at send time with an opaque error; catching it
    // here saves a confusing first-campaign failure. A blank address is not a
    // mismatch — it is the instruction to clear the sender, and the
    // deliverability report blocks a campaign while it is unset.
    if (value.fromEmail && value.domain && !value.fromEmail.endsWith(`@${value.domain}`)) {
      ctx.addIssue({
        code: "custom",
        path: ["fromEmail"],
        message: `Must be an address at your sending domain — something ending in @${value.domain}`,
      });
    }
    if (!value.apiKey && !value.hasStoredKey) {
      ctx.addIssue({
        code: "custom",
        path: ["apiKey"],
        message: "An API key is required before you can send anything.",
      });
    }
    /**
     * The prefix check the webhook secret has always had, for the key that
     * had none.
     *
     * Not cosmetic. The field is `type="password"`, so a browser password
     * manager offers to fill it, and on this instance one did: the database
     * password was stored as the Resend key, `updateEmailSettings` wrote it
     * without a murmur, and every provider read afterwards came back
     * `400 API key is invalid` — including Sync, which is how it surfaced.
     * Sending kept working only until the cached client expired.
     *
     * A prefix test is not proof the key is *live* — `verifyResendKey` asks
     * Resend that, and both writers now call it. This is the cheap half, and
     * it is the half that catches the paste that was never a key at all.
     */
    if (value.apiKey && !value.apiKey.startsWith("re_")) {
      ctx.addIssue({
        code: "custom",
        path: ["apiKey"],
        message: "Resend API keys start with `re_`.",
      });
    }
    if (value.webhookSecret && !value.webhookSecret.startsWith("whsec_")) {
      ctx.addIssue({
        code: "custom",
        path: ["webhookSecret"],
        message: "Resend webhook secrets start with `whsec_`.",
      });
    }
  });
export type EmailConfigInput = z.infer<typeof emailConfigSchema>;

export const realtimeConfigSchema = z
  .object({
    url: optionalText,
    token: optionalText,
    /** See the note on `hasStoredKey` — required for the same reason. */
    hasStoredToken: z.boolean(),
  })
  .superRefine((value, ctx) => {
    const url = value.url ?? "";
    if (!url) return; // Redis is optional; blank means "skip".

    const isWire = /^rediss?:\/\//i.test(url);
    const isRest = /^https?:\/\//i.test(url);

    if (!isWire && !isRest) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "Use redis://host:6379 for a Redis server, or an https:// REST URL from Upstash.",
      });
      return;
    }
    // The scheme decides the transport, and only Upstash's REST API needs a
    // separate token — a redis:// URL carries any credentials itself.
    if (isRest && !value.token && !value.hasStoredToken) {
      ctx.addIssue({
        code: "custom",
        path: ["token"],
        message: "An https:// URL is Upstash's REST API, which needs its token too.",
      });
    }
  });
export type RealtimeConfigInput = z.infer<typeof realtimeConfigSchema>;

export const jobsConfigSchema = z.object({
  eventKey: optionalText,
  signingKey: optionalText,
});
export type JobsConfigInput = z.infer<typeof jobsConfigSchema>;

export const adminAccountSchema = z.object({
  name: nameField("Your name", 120),
  email: emailField,
  password: newPasswordField,
});
export type AdminAccountInput = z.infer<typeof adminAccountSchema>;
