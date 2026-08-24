# Email Marketing

Staff-managed email marketing system for CorvMC. Audiences (static subscriber lists), campaigns (markdown-authored emails with live preview), public signup forms, per-audience unsubscribe, and scheduled sends. Sends via Postmark's broadcast message stream. Subscribers are email addresses — they may or may not be CorvMC members.

---

## Why this feature

CorvMC currently sends only transactional emails (reservation reminders, ticket confirmations, band invitations). There's no way for staff to send newsletters, announcements, or marketing emails to members or the public. Staff needs a tool to compose and send bulk emails to managed audiences — both members and non-members — with proper unsubscribe handling.

---

## Key concepts

**Subscribers are email addresses, not user accounts.** A subscriber record holds an email, an optional name, and an optional link to a user account. This means the same system handles members and external signups. If a member's account email matches a subscriber email, the records are linked via `userId`.

**Audiences are static lists, plus a closed set of built-ins.** Staff creates named audiences and manually adds subscribers; those don't track membership changes afterward, and staff can bulk-add all current members as a one-time snapshot. Alongside them sit four **built-in audiences** (`audience.systemKey` non-null) whose membership is a code-defined SQL predicate over member attributes, resolved at send time — see `src/lib/server/marketing/system-audience-defs.ts`. Built-ins are not a user-authored rules engine: staff cannot define new ones or edit their criteria from the UI. Only subscribers linked to a member account can match one; opt-outs are stored as `audience_member` tombstone rows.

**Campaigns are markdown emails.** Staff writes in markdown, sees a live HTML preview rendered through the existing MJML base template. Campaigns target one or more audiences. At send time, the system deduplicates across audiences and excludes anyone who has unsubscribed.

**Per-audience unsubscribe, plus a global escape hatch.** Every outbound email includes a footer link with a signed token. Clicking it unsubscribes the recipient from that specific audience without requiring login. The confirmation page then offers "unsubscribe from all", which sets `subscriber.suppressedAt` with reason `unsubscribe` — excluding the address from every campaign regardless of audience, including built-ins it would otherwise keep matching. That reason is reversible: opting in again (public signup or the account page) clears it, while `bounce` and `complaint` are never cleared this way. The RFC 8058 one-click handler is deliberately excluded from the global option; it must leave only the audience its token names. Members can also manage their subscriptions from their account page.

---

## Domain model

### Subscriber

An email address that can appear on any number of audiences.

```
subscriber
  id          uuid PK
  email       text UNIQUE NOT NULL
  name        text
  userId      text FK → user (nullable, linked if they're a member)
  createdAt   timestamp NOT NULL
```

### Audience

A named, staff-managed list of subscribers. Has a slug for public signup URLs. The `allowOptIn` flag controls whether the audience appears on the public subscribe page and in the member account subscription UI. When false, the audience is staff-managed only.

```
audience
  id          uuid PK
  name        text NOT NULL
  slug        text UNIQUE NOT NULL
  description text
  allowOptIn  boolean NOT NULL DEFAULT false
  createdAt   timestamp NOT NULL
```

### AudienceMember

Join between subscriber and audience with unsubscribe tracking. Active if `unsubscribedAt` is null.

```
audience_member
  id              uuid PK
  subscriberId    uuid FK → subscriber NOT NULL
  audienceId      uuid FK → audience NOT NULL
  unsubscribedAt  timestamp
  createdAt       timestamp NOT NULL
  UNIQUE(subscriberId, audienceId)
```

### Campaign

A markdown email composed by staff, targeting one or more audiences. Status is derived from timestamps: draft (`scheduledFor` is null, `sentAt` is null), scheduled (`scheduledFor` is set, in the future), sending (`scheduledFor` is past, `sentAt` is null), sent (`sentAt` is set).

```
campaign
  id              uuid PK
  subject         text NOT NULL
  markdownBody    text NOT NULL
  htmlBody        text NOT NULL (rendered from markdown + MJML at save time)
  scheduledFor    timestamp
  sentAt          timestamp
  sentById        text FK → user NOT NULL
  recipientCount  int
  createdAt       timestamp NOT NULL
  updatedAt       timestamp NOT NULL
```

### CampaignAudience

Join table: which audiences a campaign targets.

```
campaign_audience
  campaignId  uuid FK → campaign NOT NULL
  audienceId  uuid FK → audience NOT NULL
  PK(campaignId, audienceId)
```

---

## Derived campaign states

Campaign status is derived from timestamps — no status column.

| State     | Condition                                | Editable?                                            |
| --------- | ---------------------------------------- | ---------------------------------------------------- |
| Draft     | `scheduledFor` is null, `sentAt` is null | Yes                                                  |
| Scheduled | `scheduledFor` is set and in the future  | No (cancel back to draft by clearing `scheduledFor`) |
| Sending   | `scheduledFor` is past, `sentAt` is null | No                                                   |
| Sent      | `sentAt` is set                          | No                                                   |

The cron job picks up campaigns where `scheduledFor <= now()` and `sentAt` is null. For "send now," staff sets `scheduledFor` to the current time, which the cron picks up immediately (or a direct send function handles it inline).

---

## Public signup flow

**General subscribe page** (`/subscribe`): Lists all audiences where `allowOptIn` is true, with name and description. Each has a signup form (email + optional name). Visitors can subscribe to one or more lists from a single page.

**Direct audience link** (`/subscribe/[audience-slug]`): Shows a single audience's signup form. Only works if the audience has `allowOptIn` set to true; returns 404 otherwise.

On submit:

1. Server finds or creates a `subscriber` record by email
2. Creates an `audience_member` row. If one already exists with `unsubscribedAt` set, clears it.
3. Shows a confirmation message

No email confirmation for v1 — the form submits and the subscriber is immediately active.

---

## Unsubscribe flow

1. Every outbound campaign email includes a footer: "Unsubscribe from this list"
2. The link points to `/unsubscribe/[token]` where `token` is a signed JWT or HMAC encoding `{subscriberId, audienceId}`
3. Landing page shows "You've been unsubscribed from [audience name]" with no login required
4. Server sets `audience_member.unsubscribedAt = now()`
5. Re-subscribing via the public form clears `unsubscribedAt`

---

## Campaign send flow

1. Staff creates campaign, picks audiences, writes markdown, previews
2. Staff clicks "Send now" or "Schedule for [datetime]"
3. For immediate send: sets `scheduledFor` to now. For scheduled: sets `scheduledFor` to the chosen time.
4. Send job (cron picks up where `scheduledFor <= now()` and `sentAt` is null):
   a. For static audiences, resolve `audience_member` rows where `unsubscribedAt` is null. For built-ins, run the resolver's predicate against `user`, backfilling `subscriber` rows for members who have none, and exclude tombstoned and suppressed subscribers.
   b. Join to `subscriber` to get emails. Deduplicate by subscriber across audiences, keeping the lowest-sorted `audienceId` so the unsubscribe token is deterministic.
   c. Render final HTML from markdown + MJML base template. Include unsubscribe link per recipient.
   d. Batch send via Postmark broadcast stream (500 per API call)
   e. Update campaign: `sentAt = now()`, `recipientCount = N`
5. Staff can view the sent campaign with aggregate stats

---

## Markdown rendering

The campaign editor uses a split-pane layout: markdown on the left, rendered HTML preview on the right.

**Render pipeline:**

1. Parse markdown to HTML (using `marked` or similar)
2. Wrap in MJML base template (same branding as transactional emails)
3. Compile MJML to responsive HTML
4. Inject unsubscribe footer

The preview renders client-side on keystroke (debounced). The final send renders server-side to ensure consistency.

**Template variables** available in markdown:

- `{{subscriber_name}}` — subscriber's name (or "there" if blank)
- `{{unsubscribe_url}}` — auto-injected in footer, but available for custom placement

---

## Staff UI

### Audiences (`/staff/marketing/audiences`)

List of all audiences with name, subscriber count, and created date.

**Create audience modal:** name, slug (auto-generated from name, editable), optional description, "Allow opt-in" checkbox (default off). When enabled, the audience appears on the public subscribe page and in the member account subscription UI.

**Bulk add:** "Add all active members" button snapshots current members into the audience as subscribers.

### Audience detail (`/staff/marketing/audiences/[id]`)

Shows audience name, description, subscriber count, and a table of subscribers (email, name, joined date). Staff can:

- Add a subscriber by email (creates subscriber record if needed)
- Remove a subscriber from the audience
- See unsubscribed subscribers (grayed out, `unsubscribedAt` is set)

### Campaigns (`/staff/marketing/campaigns`)

Table of all campaigns: subject, status badge, target audiences, recipient count (if sent), sent date, created date. Filterable by status.

### Campaign composer (`/staff/marketing/campaigns/new`, `/staff/marketing/campaigns/[id]/edit`)

Split pane:

- **Left:** subject input, audience multi-select, markdown textarea (monospace, generous height)
- **Right:** live HTML preview rendered in an iframe or sandboxed div

Action buttons:

- **Save draft** — saves without sending
- **Send now** — confirms ("Send to ~N recipients?"), then sends
- **Schedule** — datetime picker, then schedules

### Campaign detail (`/staff/marketing/campaigns/[id]`)

Read-only view of a sent campaign: rendered HTML, metadata (sent by, sent at, recipient count, audiences targeted). Aggregate stats from Postmark API (delivered, opened, bounced) displayed if available.

---

## Member account integration

Add a "Subscriptions" section to the member account page (`/member/account`). Two parts:

1. **Current subscriptions:** All audiences where the member's email appears as an active subscriber. Each has an unsubscribe toggle.
2. **Available lists:** All audiences where `allowOptIn` is true and the member is not currently subscribed. Each has a "Subscribe" button.

This queries `audience_member` via the `subscriber` record linked to their `userId`.

---

## Module boundaries

### Inside the marketing module

- `subscriber`, `audience`, `audience_member`, `campaign`, `campaign_audience` schemas
- `audience-service.ts` — CRUD for audiences, add/remove subscribers, bulk-add members
- `subscriber-service.ts` — find-or-create by email, link to user accounts
- `campaign-service.ts` — CRUD for campaigns, send logic, markdown rendering
- `unsubscribe.ts` — token signing/verification, status updates

### Integration with existing code

- **Postmark client** — reuse existing `postmark-client.ts`, but send on the broadcast stream instead of transactional
- **MJML compiler** — reuse existing `compile-template.ts` for wrapping campaign HTML in the base layout
- **User schema** — `subscriber.userId` FK links to existing user table
- **Auth** — staff auth check on all `/staff/marketing` routes, no auth on `/subscribe` and `/unsubscribe`

### What this module does NOT touch

- The existing notification/dispatcher system — campaigns are a separate sending path
- Notification preferences — campaign subscriptions are managed per-audience, not through the notification preference table

---

## Schema

### subscriber

| Column    | Type      | Constraints                             |
| --------- | --------- | --------------------------------------- |
| id        | uuid      | PK, default random                      |
| email     | text      | NOT NULL, UNIQUE                        |
| name      | text      | nullable                                |
| userId    | text      | FK → user, nullable, on delete set null |
| createdAt | timestamp | NOT NULL, default now()                 |

Indexes: unique on `email`, index on `userId`.

### audience

| Column      | Type      | Constraints             |
| ----------- | --------- | ----------------------- |
| id          | uuid      | PK, default random      |
| name        | text      | NOT NULL                |
| slug        | text      | NOT NULL, UNIQUE        |
| description | text      | nullable                |
| allowOptIn  | boolean   | NOT NULL, default false |
| systemKey   | text      | nullable, UNIQUE        |
| createdAt   | timestamp | NOT NULL, default now() |

Indexes: unique on `slug`, unique on `system_key`.

`systemKey` is null for a staff-curated static list. Non-null names a built-in resolver in `system-audience-defs.ts`; those rows are provisioned idempotently by `ensureSystemAudiences()` and reject delete, add/remove subscriber, bulk-add, slug change, and opt-in.

### audience_member

| Column         | Type      | Constraints                        |
| -------------- | --------- | ---------------------------------- |
| id             | uuid      | PK, default random                 |
| subscriberId   | uuid      | FK → subscriber, NOT NULL, cascade |
| audienceId     | uuid      | FK → audience, NOT NULL, cascade   |
| unsubscribedAt | timestamp | nullable (null = active)           |
| createdAt      | timestamp | NOT NULL, default now()            |

Indexes: unique on `(subscriberId, audienceId)`, partial index on `audienceId` where `unsubscribedAt` is null for recipient resolution.

### campaign

| Column         | Type      | Constraints             |
| -------------- | --------- | ----------------------- |
| id             | uuid      | PK, default random      |
| subject        | text      | NOT NULL                |
| markdownBody   | text      | NOT NULL                |
| htmlBody       | text      | NOT NULL                |
| scheduledFor   | timestamp | nullable (null = draft) |
| sentAt         | timestamp | nullable                |
| sentById       | text      | FK → user, NOT NULL     |
| recipientCount | int       | nullable                |
| createdAt      | timestamp | NOT NULL, default now() |
| updatedAt      | timestamp | NOT NULL, default now() |

Indexes: partial index on `scheduledFor` where `sentAt` is null (for cron pickup), index on `sentById`.

### campaign_audience

| Column     | Type | Constraints                      |
| ---------- | ---- | -------------------------------- |
| campaignId | uuid | FK → campaign, NOT NULL, cascade |
| audienceId | uuid | FK → audience, NOT NULL, cascade |

Primary key: `(campaignId, audienceId)`.

---

## Notifications

No in-app notifications for campaigns. Campaigns are email-only by design.

---

## Permissions

| Action                        | Who                  |
| ----------------------------- | -------------------- |
| Create/edit/delete audience   | Staff                |
| Add/remove audience members   | Staff                |
| Bulk-add members to audience  | Staff                |
| Create/edit/send campaign     | Staff                |
| View campaign stats           | Staff                |
| Subscribe via public form     | Anyone (no auth)     |
| Unsubscribe via link          | Anyone (no auth)     |
| View/manage own subscriptions | Authenticated member |

---

## What changes

| Area                | Change                                                                           |
| ------------------- | -------------------------------------------------------------------------------- |
| Schema              | Add 5 tables: subscriber, audience, audience_member, campaign, campaign_audience |
| Staff nav           | Add "Marketing" section with Campaigns and Audiences links                       |
| Staff routes        | New `/staff/marketing/*` routes                                                  |
| Public routes       | New `/subscribe/[slug]` and `/unsubscribe/[token]` routes                        |
| Member account page | Add "Subscriptions" section                                                      |
| Postmark config     | Set up broadcast message stream (separate from transactional)                    |
| Dependencies        | Add markdown parser (`marked` or similar)                                        |

## What doesn't change

| Area                     | Notes                                                          |
| ------------------------ | -------------------------------------------------------------- |
| Notification system      | Campaigns are a separate path from transactional notifications |
| Notification preferences | No overlap — campaign subscriptions are per-audience           |
| Existing email templates | Transactional templates untouched                              |
| Member profile/directory | No changes                                                     |

---

## Deferred

- **Email confirmation on signup** — double opt-in for public signups. Important for deliverability long-term but adds complexity (pending state, confirmation email, expiry). Revisit when list sizes grow.
- **Staff-authored audience rules** — a UI for defining audiences by arbitrary member attributes (genre, instrument, join date). Partially superseded: four attribute-defined audiences now ship as built-ins (All Members, Sustaining Members, Non-Sustaining Members, Band Leaders), but the set is closed and code-defined. A general rules engine remains deferred; add a new built-in in `system-audience-defs.ts` instead.
- **Campaign-scoped unsubscribe** — an unsubscribe link removes the recipient from the one audience its token was signed for, not from every audience the campaign targeted. When a campaign targets several audiences, the token is scoped to the lowest-sorted audience the recipient matched.
- **Per-recipient tracking** — webhook-driven delivery/open/bounce status per recipient. V1 uses aggregate stats from Postmark's API.
- **Campaign analytics dashboard** — charts for open rates, click rates, trends over time. V1 shows raw counts on the campaign detail page.
- **A/B testing** — send variants to subsets and compare. Standard email marketing feature but not needed for v1.
- **Campaign templates** — save and reuse message templates. Staff can copy a past campaign for now.
- **Rich text editor** — WYSIWYG alternative to markdown. Markdown + preview is sufficient for v1.

---

## Open questions

None — design is complete for v1 scope.
