# Custom email templates

Sendstack ships four designs — Simple, Announcement, Newsletter and Plain —
and lets you upload your own. An uploaded template is a complete HTML
document with placeholders; the renderer fills them per message, exactly as it
does for the built-in designs, and the result goes through the same send
pipeline with the same unsubscribe headers, suppression checks and plain-text
alternative.

Upload and manage them in **Settings → Email → Your templates**. They then
appear under "Your templates" in the Design picker when you compose a message
or create a campaign.

## Having one written for you

You do not have to write HTML. The same settings section has two
copy-to-clipboard prompts:

- **Design a template from a brief** — describe the look, paste the prompt into
  any AI assistant, upload what comes back.
- **Adapt an existing HTML email** — paste an email you already have; the
  prompt asks for it to be converted to the contract below with its look kept.

Both prompts are generated from the same slot list the validator and renderer
use (`packages/shared/src/custom-templates.ts`), so they cannot promise a
placeholder the renderer does not fill. If the prompt is followed, the upload
is accepted without edits.

## The contract

A template is rendered by substituting these placeholders. Anything else
between double braces is rejected at upload.

| Placeholder | Required | Filled with |
| --- | --- | --- |
| `{{{ body }}}` | yes, exactly once | The message written in the composer, as HTML. Three braces: it is inserted as markup, not escaped. |
| `{{ subject }}` | | The subject line. |
| `{{ preheader }}` | | Inbox preview text. Empty when none was set. |
| `{{ unsubscribeUrl }}` | yes | A per-recipient unsubscribe link on bulk mail. Empty on one-to-one mail. |
| `{{ appName }}` | | The workspace name. |
| `{{ appUrl }}` | | The public URL of the instance. |
| `{{ logoUrl }}` | | Absolute URL of the uploaded logo. Empty when none is uploaded. |
| `{{ primaryColor }}` | | The brand colour, as `#rrggbb`. |
| `{{ postalAddress }}` | | The sender's physical address from Settings → Email. Empty when none is set. |

Recipient merge fields — `{{ firstName }}`, `{{ lastName }}`, `{{ email }}`,
`{{ company }}`, `{{ position }}`, `{{ phone }}`, `{{ attributes.key }}` —
also work, because a campaign renders the template once per recipient. On a
one-to-one message they are empty.

**Conditional blocks.** `{{#if name}} … {{/if}}` keeps its contents only when
that value is non-empty. There is no `else`. Blocks cannot nest and cannot
contain `{{{ body }}}` — the validator refuses both, because the renderer
would otherwise ship the tokens as literal text. This is
how a template hides its unsubscribe footer on one-to-one mail, its logo when
none is uploaded, and its address line when none is set:

```html
{{#if unsubscribeUrl}}
  <p><a href="{{ unsubscribeUrl }}">Unsubscribe</a></p>
{{/if}}
{{#if postalAddress}}<p>{{ postalAddress }}</p>{{/if}}
```

Every text placeholder is HTML-escaped on the way in. Only `{{{ body }}}` is
inserted raw, and the body is spliced in *after* the other placeholders are
resolved, so a literal `{{ … }}` in a message is never resolved a second time
against the template.

## What the validator refuses

Uploads are checked in the browser before the request and again on the
server, by the same function. Every problem is listed at once. A template is
refused when it:

- has no `{{{ body }}}`, or more than one, or writes it with two braces;
- uses three braces for anything other than `body`;
- has no `{{ unsubscribeUrl }}` — bulk mail without a visible unsubscribe link
  is reported as spam instead, which costs a sender far more;
- uses a placeholder the renderer does not fill (it would print as nothing in
  every inbox), or a brace pair that is not a placeholder at all;
- has an `{{#if}}` without a matching `{{/if}}`, a `{{/if}}` before any open,
  a block inside another block, a block around `{{{ body }}}`, or
  `{{#if body}}`;
- contains a `<script>` tag;
- is over 256KB. Gmail clips messages over about 102KB and shows
  "[Message clipped]" in place of the footer — where the unsubscribe link
  lives — so keep the template itself well under 100KB.

## Storage and lifecycle

- Templates live in the `templates` table. The HTML is stored exactly as
  uploaded; what Settings previews is what a campaign sends.
- Uploading the same HTML twice is one template. The content checksum is
  unique, and the second upload is told which existing template it matched.
  Two templates cannot share a name (case-insensitively).
- A campaign records its uploaded template in `campaigns.custom_template_id`,
  a foreign key. That wins over `email_template` (the built-in kind) when set;
  when neither is set, the instance default from Settings applies.
- A template cannot be deleted while a draft, scheduled, sending or paused
  campaign uses it. Campaigns already sent keep their rendered copy in every
  recipient's inbox and lose only the pointer (`ON DELETE SET NULL`).
- The send job loads the template once per run, beside the brand, and renders
  it for every recipient in that run — never one read per message.
- The instance-wide **default** design is built-in only. A default has to
  survive forever; an uploaded template can be deleted.

## Previews

The settings list and the Design picker preview templates through
`/api/templates/preview?template=<ref>`, where `<ref>` is a built-in kind or
`custom:<id>`. The preview renders with sample copy inside an iframe with
`sandbox=""` and a `Content-Security-Policy: sandbox` header. An uploaded
template was written by an operator, but it is displayed inside that
operator's signed-in session — the sandbox is what makes that safe.
