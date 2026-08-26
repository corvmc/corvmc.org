# Email Marketing — Implementation Plan

Sequenced for a solo developer working through it PR by PR. Each epic builds on the previous one.

---

## Epic 1: Schema + dependencies

Add the 5 new tables and install the markdown parser. Everything else depends on this.

### 1.1 Install `marked` dependency

```
pnpm add marked
```

This is the only new dependency — Postmark client and MJML are already in the project.

### 1.2 Create `src/lib/server/db/schema/marketing.ts`

Define all 5 tables following the existing drizzle schema pattern (see `band.ts`, `notification.ts`):

**`subscriber`** — `id` (uuid PK), `email` (text, unique, not null), `name` (text, nullable), `userId` (text, FK → user, nullable, on delete set null), `createdAt` (timestamp, not null, default now). Indexes: unique on email, index on userId.

**`audience`** — `id` (uuid PK), `name` (text, not null), `slug` (text, unique, not null), `description` (text, nullable), `allowOptIn` (boolean, not null, default false), `createdAt` (timestamp, not null, default now). Indexes: unique on slug.

**`audienceMember`** — `id` (uuid PK), `subscriberId` (uuid FK → subscriber, cascade, not null), `audienceId` (uuid FK → audience, cascade, not null), `unsubscribedAt` (timestamp, nullable), `createdAt` (timestamp, not null, default now). Indexes: unique on (subscriberId, audienceId), partial index on audienceId where unsubscribedAt is null.

**`campaign`** — `id` (uuid PK), `subject` (text, not null), `markdownBody` (text, not null), `htmlBody` (text, not null), `scheduledFor` (timestamp, nullable), `sentAt` (timestamp, nullable), `sentById` (text FK → user, not null), `recipientCount` (integer, nullable), `createdAt` (timestamp, not null, default now), `updatedAt` (timestamp, not null, default now). Indexes: partial index on scheduledFor where sentAt is null (cron pickup), index on sentById.

**`campaignAudience`** — composite PK on (campaignId, audienceId). Both uuid FKs with cascade.

### 1.3 Export from schema index

Add `export * from './marketing';` to `src/lib/server/db/schema/index.ts`.

### 1.4 Generate migration

User runs `drizzle-kit generate` and `drizzle-kit migrate`.

**Done when:** All 5 tables exist in the database and drizzle can query them.

---

## Epic 2: Subscriber + audience services

Core CRUD and query logic for managing subscribers and audiences. No UI yet — just the service layer.

### 2.1 Create `src/lib/server/marketing/subscriber-service.ts`

Functions:

- **`findOrCreateByEmail(email, name?)`** — Looks up subscriber by email. If not found, creates one. Returns the subscriber row. Used by both staff add and public signup.
- **`linkToUser(subscriberId, userId)`** — Sets the userId FK. Called when we can match a subscriber email to a member account.
- **`findByEmail(email)`** — Simple lookup, returns subscriber or null.
- **`findByUserId(userId)`** — Find subscriber record linked to a user account.

### 2.2 Create `src/lib/server/marketing/audience-service.ts`

Functions:

- **`createAudience(name, slug, description?, allowOptIn?)`** — Insert a new audience. Validate name length (max 255), slug format (lowercase, hyphens, max 100). `allowOptIn` defaults to false.
- **`updateAudience(id, data)`** — Update name/slug/description.
- **`deleteAudience(id)`** — Hard delete an audience (cascades to audience_member and campaign_audience rows).
- **`listAudiences()`** — Return all audiences with active subscriber count (count where unsubscribedAt is null).
- **`getAudience(id)`** — Single audience with subscriber count.
- **`getAudienceBySlug(slug)`** — For public signup page lookup.
- **`addSubscriber(audienceId, subscriberId)`** — Insert audience_member row. If one already exists with unsubscribedAt set, clear it (re-subscribe). If already active, no-op.
- **`removeSubscriber(audienceId, subscriberId)`** — Hard delete the audience_member row (staff removal, not unsubscribe).
- **`bulkAddMembers(audienceId)`** — Query all users, find-or-create subscriber records for each, add to audience. Returns count added.
- **`listSubscribers(audienceId)`** — Return all audience_member rows joined with subscriber, including unsubscribed ones. Ordered by createdAt desc.
- **`getSubscriptionsForUser(userId)`** — Return all audiences where this user's subscriber record is an active member. For the member account page.
- **`getOptInAudiences()`** — Return all audiences where `allowOptIn` is true. Used by the public subscribe page and member account opt-in UI.
- **`getOptInAudiencesForUser(userId)`** — Return opt-in audiences the user is _not_ currently subscribed to. For the member account "available lists" section.
- **`unsubscribe(subscriberId, audienceId)`** — Set unsubscribedAt = now() on the audience_member row.

### 2.3 Create `src/lib/server/marketing/unsubscribe.ts`

Token signing and verification for passwordless unsubscribe links.

- **`signUnsubscribeToken(subscriberId, audienceId)`** — Create an HMAC-signed token encoding both IDs. Use a `MARKETING_UNSUBSCRIBE_SECRET` env var (fall back to a hash of POSTMARK_SERVER_TOKEN for dev).
- **`verifyUnsubscribeToken(token)`** — Verify and decode. Returns `{ subscriberId, audienceId }` or null if invalid/tampered.

Implementation: base64url-encode `subscriberId:audienceId:timestamp`, append HMAC-SHA256 signature. No expiry needed — unsubscribe links should work forever.

**Test:** `signUnsubscribeToken` round-trips through `verifyUnsubscribeToken`. Tampered tokens return null.

**Done when:** Service functions can create audiences, manage subscribers, and sign/verify unsubscribe tokens. Tested at the service level.

---

## Epic 3: Campaign service + markdown rendering

Build the campaign CRUD and the markdown → MJML → HTML rendering pipeline.

### 3.1 Create `src/lib/server/marketing/campaign-render.ts`

The rendering pipeline:

1. Parse markdown body to HTML using `marked`
2. Replace template variables: `{{subscriber_name}}`, `{{unsubscribe_url}}`
3. Wrap the HTML content in MJML `<mj-text>` blocks
4. Pass through the existing `compileEmail()` from `notification/email/compile-template.ts` — but with a **campaign-specific footer** that says "Unsubscribe from this list" instead of the transactional footer

This means either:

- Make `compileEmail` accept an optional footer override, or
- Create a `compileCampaignEmail(content, previewText, footerHtml)` variant

The second is cleaner — campaigns have different footer needs than transactional emails.

Functions:

- **`renderCampaignPreview(markdown)`** — For the live editor preview. Returns HTML string. Uses placeholder values for template variables.
- **`renderCampaignForSend(markdown, subscriberName, unsubscribeUrl)`** — For actual send. Returns full HTML email with real variable values.

**Test:** Render a markdown string, verify the output contains expected HTML, unsubscribe link, and subscriber name substitution.

### 3.2 Create `src/lib/server/marketing/campaign-service.ts`

Functions:

- **`createCampaign(subject, markdownBody, audienceIds, sentById)`** — Insert campaign row (render htmlBody from markdown at save time), insert campaign_audience rows. Returns campaign.
- **`updateCampaign(id, data)`** — Update subject, markdown, audiences. Re-render htmlBody. Only allowed when campaign is in draft state (scheduledFor is null and sentAt is null).
- **`deleteCampaign(id)`** — Hard delete. Only allowed in draft state.
- **`getCampaign(id)`** — Single campaign with joined audience names.
- **`listCampaigns(statusFilter?)`** — All campaigns with status derived from timestamps, audience names, recipient count. Filterable by derived status.
- **`scheduleCampaign(id, scheduledFor)`** — Set scheduledFor. Must be in draft state and scheduledFor must be in the future.
- **`unscheduleCampaign(id)`** — Clear scheduledFor back to null (return to draft). Must be in scheduled state (scheduledFor set, in the future, sentAt null).
- **`sendNow(id)`** — Set scheduledFor to now(). The cron job picks it up, or call the send function inline.
- **`getRecipientsForCampaign(id)`** — Resolve all active audience_member rows across the campaign's audiences, deduplicate by subscriber email, join to subscriber for email/name. Returns the deduplicated list.
- **`executeSend(id)`** — The actual send logic (called by cron or inline):
  1. Get recipients via `getRecipientsForCampaign`
  2. For each recipient, render the email with their name and unsubscribe URL
  3. Batch send via Postmark broadcast stream (500 per batch)
  4. Update campaign: sentAt = now(), recipientCount = N

### 3.3 Extend `postmark-client.ts` for broadcast batch sending

Add a `sendBroadcastBatch(messages[])` function that uses the Postmark batch API with the broadcast message stream. Each message in the batch has `to`, `subject`, `htmlBody`, `MessageStream: 'broadcast'`.

Postmark's batch endpoint accepts up to 500 messages per call, so chunk if needed.

### 3.4 Create cron endpoint `src/routes/api/cron/send-campaigns/+server.ts`

Following the existing cron pattern (Bearer token auth via CRON_SECRET):

1. Query campaigns where `scheduledFor <= now()` and `sentAt is null`
2. For each, call `executeSend(id)`
3. Return JSON with count of campaigns processed

**Test:** Campaign CRUD respects state constraints (can't edit sent campaign, can't schedule without audiences). Render pipeline produces valid HTML.

**Done when:** Campaigns can be created, edited, scheduled, and sent. The cron endpoint processes due campaigns.

---

## Epic 4: Staff UI — Audiences

Build the staff-facing audience management pages.

### 4.1 Create `src/routes/staff/marketing/audiences/+page.svelte` and `data.remote.ts`

List page showing all audiences with name, subscriber count, opt-in status, created date. Uses `query()` to call `listAudiences()`. Include a "Create Audience" modal (name, slug auto-generated from name but editable, optional description, "Allow opt-in" checkbox) using `command()`.

### 4.2 Create `src/routes/staff/marketing/audiences/[id]/+page.svelte` and `data.remote.ts`

Audience detail page:

- Header: audience name, description, subscriber count
- "Add subscriber" form: email input, optional name. Calls `findOrCreateByEmail` then `addSubscriber`.
- "Add all members" button: calls `bulkAddMembers`, shows count added.
- Subscriber table: email, name, joined date, unsubscribed status. Unsubscribed rows grayed out.
- Remove button per subscriber (hard removes from audience).
- Public signup URL displayed: `/subscribe/{slug}` as a copyable link.

**Done when:** Staff can create audiences, add/remove subscribers, and bulk-add all members.

---

## Epic 5: Staff UI — Campaigns

Build the campaign composer and list pages.

### 5.1 Create `src/routes/staff/marketing/campaigns/+page.svelte` and `data.remote.ts`

Campaign list: table with subject, derived status badge, target audience names, recipient count (if sent), sent date, created date. Filterable by status (all / draft / scheduled / sent).

### 5.2 Create `src/routes/staff/marketing/campaigns/new/+page.svelte` and `data.remote.ts`

Campaign composer — split pane layout:

- **Left pane:** subject input, audience multi-select (checkboxes or tag-style selector from audience list), markdown textarea (monospace font, generous height).
- **Right pane:** live HTML preview. Debounce markdown input, call `renderCampaignPreview` via a `query()` and render the result in a sandboxed div or iframe.

Action buttons: "Save draft", "Send now" (with confirm dialog showing approximate recipient count), "Schedule" (datetime picker).

The preview should call a server-side render function (not client-side MJML compilation) since MJML is a Node library.

### 5.3 Create `src/routes/staff/marketing/campaigns/[id]/edit/+page.svelte` and `data.remote.ts`

Same composer UI as new, but pre-filled. Only accessible when campaign is in draft state. Redirects to detail page if campaign is sent/scheduled.

### 5.4 Create `src/routes/staff/marketing/campaigns/[id]/+page.svelte` and `data.remote.ts`

Campaign detail (read-only for sent campaigns):

- Rendered HTML preview
- Metadata: sent by, sent at, recipient count, audiences targeted
- Status badge
- If draft: edit button, delete button
- If scheduled: cancel (unschedule) button

**Done when:** Staff can create, edit, preview, send, and schedule campaigns.

---

## Epic 6: Staff nav + public routes

Wire up the staff navigation and build the public-facing subscribe/unsubscribe pages.

### 6.1 Add Marketing section to staff layout

In `src/routes/staff/+layout.svelte`, add a "Marketing" nav group with:

- "Campaigns" → `/staff/marketing/campaigns`
- "Audiences" → `/staff/marketing/audiences`

Import `IconMail` (or `IconSend`) from `@tabler/icons-svelte`.

### 6.2 Create `src/routes/subscribe/+page.svelte` and `+page.server.ts`

General public subscribe page (no auth required):

- Server load: call `getOptInAudiences()` to get all audiences with `allowOptIn = true`.
- Page: lists each audience with name, description, and a signup form (email + optional name).
- On submit: find-or-create subscriber, add to the selected audience. Show confirmation message.

### 6.3 Create `src/routes/subscribe/[slug]/+page.svelte` and `+page.server.ts`

Direct audience signup page (no auth required):

- Server load: look up audience by slug. 404 if not found or `allowOptIn` is false.
- Page: shows audience name, description, and a form with email + optional name fields.
- On submit: find-or-create subscriber, add to audience (re-subscribe if previously unsubscribed). Show confirmation message.

### 6.4 Create `src/routes/unsubscribe/[token]/+page.svelte` and `+page.server.ts`

Public unsubscribe page (no auth required):

- Server load: verify the token. If invalid, show error.
- If valid: set `audience_member.unsubscribedAt = now()`. Show "You've been unsubscribed from [audience name]" confirmation.

### 6.5 Add "Subscriptions" section to member account page

In the existing member account page (`/member/account`), add two parts:

1. **Current subscriptions:** All audiences the member is subscribed to, each with an unsubscribe toggle. Query via `getSubscriptionsForUser(userId)`.
2. **Available lists:** All opt-in audiences the member is _not_ subscribed to, each with a "Subscribe" button. Query via `getOptInAudiencesForUser(userId)`.

This requires finding the member's subscriber record by userId (creating one if it doesn't exist), then querying their audience memberships against the opt-in audience list.

**Done when:** Staff nav links work. Public can browse and subscribe to opt-in lists. Members can subscribe/unsubscribe from their account page.

---

## Epic 7: Seed data + feature catalog + verification

### 7.1 Update `scripts/seed-dev.ts`

Add marketing seed data:

- Create 3–4 audiences ("Newsletter", "Event Updates", "Member Announcements", "Public Updates")
- Create subscriber records for all seeded users (linked via userId), plus 5–10 external subscribers (email-only)
- Add subscribers to audiences with randomized membership
- Create 3–5 campaigns in various states: 2 sent (with sentAt and recipientCount set), 1 scheduled (scheduledFor in the future), 1–2 drafts
- Wire campaigns to audiences via campaign_audience

### 7.2 Update `docs/reports/feature-catalog.md`

Add the Email Marketing row.

### 7.3 Verify

Run `svelte-check` — no new type errors in touched files. Manually walk through the staff UI flows: create audience → add subscribers → create campaign → preview → send/schedule. Test public subscribe and unsubscribe flows.

**Done when:** Seed data populates all marketing tables. Parity report is updated. No type errors.

---

## Dependency graph

```
Epic 1 (schema + deps)
  └─▶ Epic 2 (subscriber + audience services)
        └─▶ Epic 3 (campaign service + rendering)
              ├─▶ Epic 4 (staff UI — audiences)
              │     └─▶ Epic 6 (nav + public routes)
              └─▶ Epic 5 (staff UI — campaigns)
                    └─▶ Epic 6

Epic 6 ─▶ Epic 7 (seed + verify)
```

All epics are sequential for a solo developer. Epics 4 and 5 could theoretically be done in either order since they're independent of each other, but both must complete before Epic 6.

---

## Smoke tests

1. **Full campaign lifecycle:** Create an audience → add subscribers (manual + bulk-add members) → create a campaign targeting that audience → preview the markdown rendering → send now → verify campaign shows as sent with correct recipient count.

2. **Subscribe/unsubscribe round-trip:** Visit `/subscribe/[slug]` → enter email → confirm subscribed → receive a campaign email → click unsubscribe link → verify unsubscribed → re-subscribe via the public form → verify active again.

---

## Out of scope for this plan

- **Email confirmation on signup** — double opt-in deferred per spec
- **Dynamic/filter-based audiences** — static lists only for v1
- **Per-recipient tracking** — v1 uses aggregate Postmark stats
- **Campaign analytics dashboard** — raw counts on detail page only
- **A/B testing** — deferred
- **Campaign templates** — staff can copy past campaigns manually
- **Rich text editor** — markdown + preview is sufficient for v1
