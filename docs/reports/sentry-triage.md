# Sentry Triage — 2026-08-15

All issues in
[corvallis-music-collective/javascript-sveltekit](https://corvallis-music-collective.sentry.io/issues/?project=javascript-sveltekit&query=is%3Aunresolved)
collected via the Sentry MCP and traced to root cause. Supersedes the 2026-07-27
pass (see git history of this file). Environment: production only. Short IDs
link to Sentry; timestamps UTC. The `php-laravel` project has **zero** unresolved
issues.

Every issue from the 07-27 pass is now closed, and its code fixes are merged and
verified present at `f4668ff` (ProfileForm extraction, `isWebviewBridgeError`,
`user_not_found` → warning). The two operator follow-ups from that pass
(Postmark templates, bcrypt member check) are superseded by issue **22** below.

## The unresolved list understates the problem

Nine issues show as `is:unresolved`. Querying **events** rather than issues
surfaced three more that are still firing but invisible in that view — one
marked `resolved`, two `archived_forever`. One of them, **22**, was the
highest-volume error of the last 14 days.

Sentry-side archiving does not suppress a regression on a new release: **3** and
**X** are `archived_forever` and still firing on the current deploy. Only a
code-side filter is durable.

## Summary

| Sentry issue                                                                      | Title                                    | Events/Users | Last seen | Classification                                  | Action                      |
| --------------------------------------------------------------------------------- | ---------------------------------------- | ------------ | --------- | ----------------------------------------------- | --------------------------- |
| [2A](https://corvallis-music-collective.sentry.io/issues/JAVASCRIPT-SVELTEKIT-2A) | Invitation not found or already accepted | 7/5          | 08-13     | **Feature 100% broken since it shipped**        | Fixed in this branch        |
| [2C](https://corvallis-music-collective.sentry.io/issues/JAVASCRIPT-SVELTEKIT-2C) | Cannot redefine property: value          | 11/10        | **08-15** | **Live SSR crash**, regression from #207        | Fixed in this branch        |
| [21](https://corvallis-music-collective.sentry.io/issues/JAVASCRIPT-SVELTEKIT-21) | Cron failure: cancel-stale-tickets       | 6/0          | **08-15** | Phantom outage — monitoring bug, not the job    | Fixed in this branch        |
| [29](https://corvallis-music-collective.sentry.io/issues/JAVASCRIPT-SVELTEKIT-29) | Charge already refunded                  | 1/1          | 08-12     | Double refund; strands a half-cancelled booking | Fixed in this branch        |
| [2D](https://corvallis-music-collective.sentry.io/issues/JAVASCRIPT-SVELTEKIT-2D) | UNIQUE constraint: band_member           | 1/1          | 08-14     | Case-sensitive guard; downstream of 2A          | Fixed in this branch        |
| [3](https://corvallis-music-collective.sentry.io/issues/JAVASCRIPT-SVELTEKIT-3)   | UnhandledRejection `{body, status}` 403  | 28/15        | 08-13     | Blank page for pending-invite members           | Fixed in this branch        |
| [X](https://corvallis-music-collective.sentry.io/issues/JAVASCRIPT-SVELTEKIT-X)   | UnhandledRejection `{location, status}`  | 10/9         | 08-14     | Pure noise — framework control flow             | Filtered in this branch     |
| [22](https://corvallis-music-collective.sentry.io/issues/JAVASCRIPT-SVELTEKIT-22) | Postmark stream does not exist           | 17/9         | 08-10     | **All transactional email down 08-03→08-10**    | **Operator: verify config** |
| [25](https://corvallis-music-collective.sentry.io/issues/JAVASCRIPT-SVELTEKIT-25) | `c.async_deriveds` null                  | 1/1          | 08-11     | Upstream Svelte bug, unfixed in 5.56.9          | Report-only                 |
| [24](https://corvallis-music-collective.sentry.io/issues/JAVASCRIPT-SVELTEKIT-24) | JSON.parse on remote form envelope       | 1/1          | 08-10     | **Not** deploy skew this time — see correction  | Report-only                 |
| [2B](https://corvallis-music-collective.sentry.io/issues/JAVASCRIPT-SVELTEKIT-2B) | Blocking Operation (AI-detected)         | 1/0          | 08-13     | Perf observation                                | Report-only                 |
| [26](https://corvallis-music-collective.sentry.io/issues/JAVASCRIPT-SVELTEKIT-26) | Degraded UI Performance (AI-detected)    | 1/0          | 08-12     | Perf observation                                | Report-only                 |

## One story, three issues: 2A → 3 → 2D

These are not independent. **A member is invited to a band and cannot accept
(2A).** The invitation therefore stays `pending` forever. The pending band still
appears in their sidebar and panel switcher, and clicking it renders a blank
page **(3)**. The band admin, seeing the invite unaccepted, sends it again — and
hits the unique constraint **(2D)**. Fixing 2A drains the other two at the
source; each was also fixed on its own merits.

### 2A — accepting a band invitation has never worked

Not a race, not a double-submit. `acceptInvitation` matched on `band_member.id`:

```ts
eq(bandMember.id, memberId); // band-service.ts:353
```

but the only id the invite list has is the **band** id — `listForUser` selects
`id: band.id` ([band-service.ts:203](../../src/lib/server/band/band-service.ts:203)), which flows through
`getMemberBands` into the hidden input the Accept form submits
([+page.svelte:85](../../src/routes/member/bands/+page.svelte:85)). The predicate matched zero rows for every
user, every time, and the bare `throw new Error(...)` became a 500 —
7 events across 5 users in one day.

`declineInvitation` had the identical mismatch but discarded its delete result,
so the UI toasted "Invitation declined" and the invite reappeared on reload.

**Fixed:** both now key on `(bandId, userId)` — the pair the unique constraint
already enforces — and the parameter is named `bandId` so the type no longer
lies. Accept is idempotent: an already-`active` row is success, not an error.
Decline returns whether a row was actually removed. Both outcomes are returned
in-band rather than thrown, so a stale invite no longer reaches Sentry as a 500.

**Why the tests missed it:** [bands.spec.ts](../../src/routes/member/bands/bands.spec.ts) called the remote
function with a synthetic `{ memberId: 'member-42' }`, so the UI→service key was
never exercised. The tests now drive the id the UI really sends.

### 2C — `/contact` crashed on every server render (regression from #207)

`{...fields.subject.as('select')}` and `bind:value` on the same `<Select>`.
Kit's `.as('select')` defines `value` via `Object.defineProperties` **without
`configurable`**, so it is a non-configurable accessor; Svelte's _server_
`spread_props` copies descriptors with `Object.defineProperty`, and the second
`value` source throws.

Server-only: the _client_ `spread_props` is a Proxy that forces
`configurable: true`. That is why it passed dev and every client-side test while
failing on every production render — 10 users in two days on a public page.

Introduced by `f4668ff` (#207), which added `bind:value` to drive the new
Event Tip conditional; the spread was already there.

**Fixed:** the field goes through `FormField type="select"`, which builds its
select props as a plain object literal and deliberately excludes `value`
([FormField.svelte:74-84](../../src/lib/components/shared/Form/FormField.svelte:74)). Regression test in
[contact.ssr.spec.ts](<src/routes/(public)/contact/contact.ssr.spec.ts>) reproduces the exact
`TypeError` against the pre-fix page; its field mock replicates Kit's
non-configurable descriptor, because a plain `{ value }` would not catch it.

### 21 — the cron alert is a monitoring bug, not a failing job

`cancel-stale-tickets` is a single `UPDATE`
([ticket-service.ts:140](../../src/lib/server/ticket/ticket-service.ts:140)) — it cannot take 15 minutes.
The check-in id was read out of the opening **response**
(`sentry-check-in.ts:105`), opening check-ins got no retry (`:88`), and every
attempt carried a 10s abort (`:63,98`). When Sentry recorded the open check-in
but the response was slow, aborted, or unparseable, the id was lost; the close
then went out with `checkInId: undefined`, which **creates a second check-in
instead of closing the first**. The orphan timed out at `max_runtime`.

Introduced by `d1730fb` — which was itself the fix for JAVASCRIPT-SVELTEKIT-20.
It closed the drop on the close side and opened one on the open side.

**Fixed:** the id is generated client-side with `crypto.randomUUID()` before the
opening POST (Sentry's HTTP API accepts a client-supplied `check_in_id`), so the
opening response is irrelevant and every attempt is an idempotent update — which
also makes the retry safe on both sides. The terminal check-in moved into a
`finally`, and the monitored job call is now bounded (it was unbounded while the
monitoring call was capped at 10s, so one hung job could starve the whole batch).
The test that pinned the buggy `checkInId: undefined` behaviour is replaced.

### 29 — double refund strands a half-cancelled reservation

`refundPaymentIntent` guarded on `pi.amount > 0 && pi.status === 'succeeded'`,
but a PaymentIntent stays `succeeded` after a refund and its `amount` is never
decremented — the guard could not detect a prior refund. `reservation.refundedAt`
was written in three places and read in none.

Staff **Refund** deliberately does not cancel, and both buttons stayed enabled
([reservation-actions.ts:108](../../src/lib/utils/reservation-actions.ts:108)), so Refund-then-Cancel
refunded twice. The throw landed _after_ `cancel()` had flipped the row to
`cancelled` and nulled `cashDueCents`/`creditsUsed`, so credits were never
reversed, `reservation.cancelled` never emitted (no waitlist promotion, no
cancellation email), and retry was impossible because the status guard now
rejected it.

**Fixed:** `refund()` returns early when the payment is already marked refunded —
which also protects the credit ledger, since `reverseDeductions` has no dedupe
and a second pass would double-credit the member. `refundPaymentIntent` now
consults the charge's `amount_refunded` rather than the PaymentIntent status.
Refund is hidden once `refundedAt` is set. `cancel()` completes
the credit reversal and cancellation event before surfacing a refund failure, so
a Stripe error can no longer strand the row.

> **Check before deploying:** one reservation from 2026-08-12 is likely sitting
> in the half-cancelled state — cancelled, credits un-reversed, no cancellation
> event. It needs manual repair; the code fix does not heal existing rows.

**Deliberately not changed:** `reservationPaymentState`
([reservation-actions.ts:68](../../src/lib/utils/reservation-actions.ts:68)) still infers "refunded" from
`status === 'cancelled' && stripePaymentRecordId`, so a cancel whose refund
failed displays as refunded. Keying it on `refundedAt` is the correct fix, but
any reservation cancelled before that column was reliably populated would flip
to "cancelled" — a wider misdisplay than the one being fixed. It needs a query
against production first (`select count(*) from reservation where status =
'cancelled' and stripe_payment_record_id is not null and refunded_at is null`),
which is blocked on wrangler auth in this environment. The existing test pins
the current behaviour.

### 2D — the UNIQUE guard never fired

```ts
err.message.includes('unique'); // band-service.ts:346
```

D1 raises `UNIQUE constraint failed: ...`. The lowercase check never matched, so
the raw `D1_ERROR` escaped as a 500. The sibling at
[platform-invite-service.ts](../../src/lib/server/band/platform-invite-service.ts) had it right with
`'UNIQUE'`. The unit test "covering" this fabricated a lowercase message.

**Fixed:** the predicate moved to
[constraint-errors.ts](../../src/lib/server/db/constraint-errors.ts) — schema-free, so specs that mock
`drizzle-orm` can use the real implementation — matches case-insensitively, and
walks `cause`, since drizzle wraps the driver message. `createInvite` now
pre-checks `band_member` and distinguishes "already in this band" from "already
has a pending invitation", surfaced in-band via `invalid(issue.email(...))`;
`bands.remote.ts` previously never mapped domain errors at all, so even a caught
`BandMemberExistsError` became a 500. Both tests now use the real D1 message.

### 3 — a blank page for anyone with an unaccepted invite

`/band/[slug]` is the _private_ band dashboard. `listForUser` does not filter by
membership status and the layout queries mapped every row into `userBands`,
discarding `status` — so a pending invite appeared in the sidebar and panel
switcher as a live link. Clicking it hit `error(403, 'You are not a member of
this band')` and rendered **nothing at all**: the layout's own
`$derived(await getBandLayout(...))` sits _outside_ the `ErrorToastBoundary`
that wraps only `{@render children()}`. 15 users over two months.

**Fixed:** the three `layout.remote.ts` consumers filter to `status === 'active'`
(matching what [bands.remote.ts:180](../../src/lib/remote/bands.remote.ts:180) already did for the invite
list); the 403 itself stays, as the security boundary. A new
[band/+layout.svelte](../../src/routes/band/+layout.svelte) puts a boundary one level up so the layout's
own await is covered and a genuine 403 renders an error instead of a blank page.
It passes `showPending={false}` to keep server rendering identical — a boundary
with a pending snippet renders that snippet during SSR _instead of_ awaiting its
contents, which would have replaced the whole band shell with a spinner.

### X — framework control flow, not a bug

`redirect()` and `error()` throw plain `Redirect {status, location}` and
`HttpError {status, body}` instances that are **not** `Error` subclasses — no
message, no stack, hence Sentry's "Object captured as promise rejection with
keys: …".

The redirect at [volunteer.remote.ts:414](../../src/lib/remote/volunteer.remote.ts:414) is correct and
works. Kit runs `await goto(location)` and _then_ throws `Redirect(307)` purely
to settle the dangling query promise, by which point the component and its
boundary are unmounted — so no boundary can ever catch it. The thrown status is
302 at the source; the 307 is manufactured client-side, and the `location`
matches the transaction name only because `goto` already renamed the
transaction. Not a redirect loop.

The existing 4xx filter could not help: it lives in `reportError`
([report-error.ts:13](../../src/lib/report-error.ts:13)), a manual sink that unhandled rejections never
reach, and its `status >= 400` test would miss a 307 anyway. All three
`beforeSend` filters key on `message`, which these payloads do not have.

**Fixed:** `isFrameworkControlFlow` in [hooks.client.ts](../../src/hooks.client.ts) drops Redirects
and **4xx** HttpErrors in `beforeSend`, bounded so a 5xx still reports.

## Operator action required

### 22 — the production Postmark server has no matching message streams

Marked `resolved` and quiet since 08-10, but this was the highest-volume error of
the period and the blast radius was total. The event history shows the configured
stream changed mid-window and **neither value existed** on the server the
production `POSTMARK_SERVER_TOKEN` points at:

| Window        | `POSTMARK_TRANSACTIONAL_STREAM` | Failing paths                                                                                                                           |
| ------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 08-03 → 08-05 | `corvmc-transactional`          | `/contact`, `/member/reservations`, `/staff/inbox/[id]`, crons: `reservation-reminders`, `cancel-unconfirmed`, `confirmation-reminders` |
| 08-08 → 08-10 | `outgoing`                      | `/api/stripe/webhook` (×4), `/contact`, `/staff/inbox/[id]` (×2)                                                                        |

Every transactional email path was failing, including Stripe receipts and three
scheduled jobs. The code is correct —
[postmark-client.ts:31-41](../../src/lib/server/notification/email/postmark-client.ts:31) reads both
stream ids from the environment with no fallback, by design.

This corroborates the 07-27 report's unproven hypothesis that the production
token points at the **wrong Postmark server**, which would explain the missing
_templates_ in that pass's issue 18 as well.

1. Confirm which Postmark server the production `POSTMARK_SERVER_TOKEN` belongs to.
2. Confirm streams matching `POSTMARK_TRANSACTIONAL_STREAM` and
   `POSTMARK_BROADCAST_STREAM` exist on **that** server, along with the template
   aliases.
3. Consider a health check so a missing stream fails loudly once rather than
   silently per send.

Mail lost in the 08-03 → 08-10 window (reservation reminders, receipts, inbox
replies) may warrant a re-send.

## Report-only

- **25** — `TypeError: null is not an object (evaluating 'c.async_deriveds')` on
  `/member/reservations`, inside Svelte's async internals at
  `batch.async_deriveds.set(effect, d)` where the batch is null. Matches a known
  upstream class — the batch is flushed before the next top-level await gets hold
  of the current batch — and is **not fixed in 5.56.9**, the newest release. The
  page has several concurrent `$derived(await …)` and `{#each await …}`
  ([+page.svelte:32-114](../../src/routes/member/reservations/+page.svelte:32)), which is the shape that
  triggers it. 1 event, 1 user. No app-side fix; worth reporting upstream.
- **24** — `SyntaxError: JSON.parse` on a remote form envelope, `/band/[slug]/edit`.
  **Correction to the note carried from the previous occurrence:** this was _not_
  deploy skew. The event fired on release `aad2773`, which was the newest commit
  at the time — nothing merged between that commit and the event — so the
  client and server were on the same build. 1 event, 1 user; not diagnosed
  further. Do not re-apply the stale skew explanation without re-checking the
  release tag.
- **2B / 26** — Sentry AI-detected performance observations on
  `saveMemberProfile` and `/about`, 1 event each, 0 users impacted. Same
  disposition as the previous pass's 1C/1D: revisit only on real user impact.

## Sentry statuses

Unchanged by this pass — nothing was written to Sentry. Commit messages carry
`Fixes JAVASCRIPT-SVELTEKIT-XX` so merges auto-close. **3** and **X** are
`archived_forever` and will need un-archiving manually if they should resurface.
