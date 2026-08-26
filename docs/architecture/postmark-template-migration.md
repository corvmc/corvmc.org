# Postmark Template Migration

Move transactional email templates from in-app MJML/HTML generation to
Postmark-hosted templates, with the **repo as the source of truth** (templates
are files in `postmark/templates/`, pushed to Postmark via `postmark-cli`).

## Why

- Edit/preview/test-send copy in Postmark without a deploy.
- Delete ~500 lines of in-repo email machinery (`templates.ts`,
  `html-helpers.ts`, `compile-template.ts`) and the MJML build step.
- Resolve the stale `email-layout-transactional` type error.
- Keep version control + PR review by storing templates as files and syncing.

## Scope

**In scope** — migrate to Postmark templates (16 functions in `templates.ts`):

| Function                       | Postmark alias                | Notes                                                                       |
| ------------------------------ | ----------------------------- | --------------------------------------------------------------------------- |
| ticketConfirmation             | `ticket-confirmation`         | `{{#each ticketCodes}}` loop + singular/plural via `{{#if multiple}}`       |
| eventCancellation              | `event-cancellation`          |                                                                             |
| checkInReminder                | `check-in-reminder`           |                                                                             |
| reservationReminder            | `reservation-reminder`        |                                                                             |
| confirmationReminder           | `confirmation-reminder`       |                                                                             |
| bandInvitation                 | `band-invitation`             |                                                                             |
| bandInvitationAccepted         | `band-invitation-accepted`    |                                                                             |
| platformInvitation             | `platform-invitation`         |                                                                             |
| contactFormForward             | `contact-form-forward`        |                                                                             |
| loanScheduledConfirmation      | `loan-scheduled-confirmation` |                                                                             |
| loanRequestedStaffNotification | `loan-requested-staff`        | conditional notes/item via `{{#if}}`                                        |
| recurringSkipped               | `recurring-skipped`           |                                                                             |
| recurringWaitlisted            | `recurring-waitlisted`        |                                                                             |
| waitlistSlotAvailable          | `waitlist-slot-available`     |                                                                             |
| waitlistExpired                | `waitlist-expired`            |                                                                             |
| inboxReply                     | `inbox-reply`                 | text-only (see Plaintext rule); keeps threading headers + returns MessageID |

Plus one **Layout** template `corvmc-transactional` (the wrapper), reusing the
HTML the MJML build currently produces.

**Out of scope** — the marketing campaign path (`sendBroadcastBatch`,
`campaign-render.ts`, `CAMPAIGN_LAYOUT`). It stays as-is; the MJML build step is
trimmed to compile _only_ the campaign layout. The `email-layout-campaign` type
error is pre-existing and unrelated.

## Decisions

- **Source of truth:** repo (`postmark/templates/`), pushed via `postmark-cli`.
  Dashboard edits must be pulled back (`pnpm email:pull`) or they're lost.
- **Subjects** move into each template's `meta.json` `Subject` (Mustachio), so
  listeners no longer build subject strings.
- **Preview text** becomes a `preview_text` model field rendered by the layout.
- **inboxReply** moves too, enabling full deletion of `templates.ts`.
- **Escaping:** Mustachio escapes `{{var}}` by default, in the text part as well
  as the HTML one. HTML templates stay double-brace, except `notification`'s
  `quote` (below). Text-only templates use triple braces throughout — an
  entity-encoded `&` or `'` is simply wrong in a `text/plain` body.

## Plaintext rule

**An email the recipient can reply to is sent as plain text with no layout.
`corvmc-transactional` is for one-way mail only.**

Brand chrome on a message someone is meant to answer buries the content and
makes the reply feel like it goes to a robot. Two templates qualify today —
`inbox-reply` (staff answering a contact) and `contact-alert` (staff answering
the contact form from their own mail client). Both are a `meta.json` with no
`LayoutTemplate` plus a `content.txt`, and **no `content.html` at all**;
`postmark-cli` pushes the HtmlBody as empty, so Postmark sends a single-part
`text/plain` message.

`render.spec.ts` derives the split from the absence of `LayoutTemplate` and
asserts the rule on every fixture, including that each plaintext body actually
tells the reader they can reply. The tooling that reads `content.html`
(`render-preview.ts`, `email-validate.ts`, `email-preview.ts`, `brand.spec.ts`)
all guards on `existsSync` for this reason.

## Template directory format (`postmark-cli`)

Layouts live under `_layouts/`, standard templates in the root (verified
against the postmark-cli wiki):

```
postmark/templates/
  _layouts/
    corvmc-transactional/      # the Layout
      meta.json                # { Name, Alias, TemplateType: "Layout" }
      content.html             # wrapper with {{{@content}}} + {{preview_text}}
      content.txt
  ticket-confirmation/
    meta.json                  # { Name, Alias, Subject, TemplateType: "Standard", LayoutTemplate: "corvmc-transactional" }
    content.html               # inner content, Mustachio vars
    content.txt                # plaintext fallback
  ...
```

Layout injects template content with the `{{{@content}}}` placeholder.
Push: `postmark templates push postmark/templates --server-token $POSTMARK_SERVER_TOKEN`

## Send-path changes

- `postmark-client.ts`: add
  - `sendEmailWithTemplate({ to, templateAlias, model, tag, metadata })`
  - `sendInboxReplyWithTemplate({ to, model, inReplyTo, references, metadata })` → returns MessageID
  - extend `checkEmailService()` to verify required template aliases exist
    (`getTemplates()` / `getTemplate(alias)`), so a missing template pages us.
- `dispatcher.ts`: replace `emailSubject?`/`emailHtml?` in `DispatchParams` with
  `emailTemplate?: { alias: string; model: Record<string, unknown> }`; replace
  `dispatchEmailOnly`'s `subject`/`html` with `templateAlias`/`model`.
- `notification-listeners.ts`: each listener passes `{ alias, model }` instead of
  building HTML; drops subject construction (now in template meta).
- `channel-dispatcher.ts` (inbox): call `sendInboxReplyWithTemplate`.

## Deletions

- `src/lib/server/notification/email/templates.ts`
- `src/lib/server/notification/email/html-helpers.ts`
- `src/lib/server/notification/email/compile-template.ts`
- `src/lib/server/generated/email-layout-transactional.ts` (generated; stop emitting)
- Trim `scripts/compile-email-layouts.ts` to campaign-only; update `email/index.ts`.

## Tooling

- Add `postmark-cli` devDependency.
- `package.json` scripts:
  - `email:push` → `postmark templates push postmark/ --server-token $POSTMARK_SERVER_TOKEN`
  - `email:pull` → `postmark templates pull postmark/ --server-token $POSTMARK_SERVER_TOKEN`
- Deploy pipeline: run `email:push` on deploy (NEEDS USER INPUT — confirm CI/deploy
  mechanism; crons are external POSTs, so deploy wiring is unknown).

## Checklist

- [x] 1. Add `postmark-cli` dep + `email:push`/`email:pull` scripts
- [x] 2. Create `postmark/templates/_layouts/corvmc-transactional/` Layout from current HTML
- [x] 3. Create all 15 standard template dirs (meta.json + content.html + content.txt). `checkInReminder` was dead code — dropped, not migrated.
- [x] 4. `sendEmailWithTemplate` + template-based `sendInboxReply` in postmark-client
- [x] 5. Refactor `dispatcher.ts` (DispatchParams + dispatchEmailOnly)
- [x] 6. Refactor all call sites in `notification-listeners.ts`
- [x] 7. Refactor inbox `channel-dispatcher.ts`
- [x] 8. Extend `checkEmailService()` to verify template aliases exist (`REQUIRED_TEMPLATE_ALIASES`)
- [x] 9. Delete templates.ts / html-helpers.ts / compile-template.ts + generated transactional layout; update email/index.ts (also removed now-dead raw `sendEmail`)
- [x] 10. Trim `scripts/compile-email-layouts.ts` to campaign-only (+ TODO for future campaign migration) — **superseded**: the script and the `mjml` dep are gone, replaced by `src/lib/server/marketing/campaign-layout.ts`
- [x] 11. Update tests — dispatcher.spec + notification-listeners.spec rewritten to assert template alias + model (25 tests pass)
- [x] 12. `pnpm check` — transactional-layout error gone; only the pre-existing `email-layout-campaign` build-artifact error remains. **Now also resolved** by the campaign-layout move: `pnpm check` reports 0 errors.
- [ ] 13. **(needs Postmark creds)** First `pnpm email:push` to the prod Postmark server; send-test each alias. Run `pnpm email:validate` first — it renders every template through real Mustachio without sending, reading `POSTMARK_SERVER_TOKEN` from `.env`. Note `email:push`/`email:pull` do **not** read `.env` (they shell out to `postmark-cli`), so those still need the token exported.
- [ ] 14. **(deploy is manual)** Run `pnpm email:push` BEFORE `wrangler deploy` — otherwise transactional sends fail with template-not-found. Make this a deploy-runbook step.
- [ ] 15. **(deploy sequencing)** Deploy static assets BEFORE `email:push`. The layout hardcodes `https://corvmc.org/email/cmc-speaker.png` (Postmark templates can't read env), so the logo 404s in every email until `static/email/` is live.

## Brand redesign (2026-08)

The templates were restyled onto the CMC identity — see
`design-system/project/email_templates/` for the reference designs this ports.
Notes that affect how you edit them:

- **Palette**: the design-system hexes (`#e5771e`, `#00859b`, `#003b5c`, …), which
  is what `cmc-speaker.png` is drawn in. Mirrored in `src/lib/email/brand.ts`;
  `src/lib/email/brand.spec.ts` fails if a template introduces a non-brand hex or
  reorders the tri-stripe.
- **Iteration syntax**: Mustachio accepts both `{{#each xs}}` and `{{#xs}}`, but the
  local preview renderer (Handlebars) only accepts `{{#each}}`. Use `{{#each}}`.
- **`has_details`**: the details-card wrapper is guarded by a derived boolean, not by
  `{{#details}}` — a bare section over an array _iterates_ in both engines and would
  repeat the whole card per row. `normalizeNotificationModel` sets it.
- **Escaping**: in the HTML templates `{{{…}}}` survives in exactly one place —
  `notification`'s `quote`, fed only through `normalizeNotificationModel`, which
  escapes it and converts newlines to `<br />`. Everything else there is escaped by
  the engine, so listeners must pass plain text. The text-only templates are the
  opposite: triple-brace throughout, since HTML entities have no business in a
  `text/plain` part.
- **Preview locally**: `pnpm email:preview`, then open `.email-preview/index.html`.
  It rewrites the logo URL to a local copy so the header renders before deploy.

## ⚠️ Deploy sequencing

Deploys are manual (`wrangler deploy` / `--env production`); there is no CI deploy job.
Because transactional email now renders entirely from Postmark-hosted templates, the
templates MUST exist on the target server before the new code runs:

1. Merge this branch.
2. `POSTMARK_SERVER_TOKEN=<prod token> pnpm email:push`
3. `wrangler deploy` (and `--env production`).

A missing template surfaces as a failed send reported to Sentry (`email.send`).

```

```
