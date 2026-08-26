# Volunteering Phase 2 — progress checklist

Design: `docs/specs/shipped/volunteering-spec.md` §Phase 2 (line 264) and §Certifications
(line 302). Plan: `~/.claude/plans/deep-drifting-kernighan.md` (approved).
Phase 1 checklist: `volunteering-checklist.md`.

Building certifications **and** shifts in one pass, plus the post-shift survey.

## Model recap

- **Six new tables**, 32 → 38. Certifications: `volunteer_certification`
  (catalog), `member_certification` (held, append-only),
  `volunteer_role_certification` (join). Shifts: `volunteer_shift`,
  `volunteer_signup`. Feedback: `volunteer_shift_feedback`.
- **Held certifications append; renewals never overwrite.** Hence **no unique
  constraint** on `(userId, certificationId)`. This is the only way to answer
  "was their First Aid current on the night of the incident?"
- **`expiresAt` is stamped at grant time** from `validityMonths`, never computed
  on read — editing a catalog entry must not retroactively expire cards issued
  under the old rule.
- **No status column for certifications.** current / expiring soon / expired /
  revoked is derived from dates against `clubToday()`.
- **The as-of-a-date predicate, and its asymmetry** (spec line 460):
  `grantedAt <= worked AND (expiresAt IS NULL OR expiresAt >= worked) AND
(revokedAt IS NULL OR revokedAt > worked)`. A clearance pulled _on_ the day was
  not in force; a card is valid _through_ its expiry date. Easy to invert — pin
  it with a test.
- **Revoke, don't delete.** Hard delete only for a record that was never true (a
  typo), and only same-day by the same staffer. `revokedReason` required whenever
  `revokedAt` is set.
- **Certifications are advisory for hour logs, gating for shift claims.** Someone
  who did the work can always log it; refusing the hours doesn't undo the work.
- **Signup statuses mirror `reservationStatuses`**: claimed → confirmed →
  completed, plus cancelled and no_show. Same words for the same states.
- **One-off shifts only.** No recurrence this pass; `recurring_series`
  generalizes by `prototypeType` if that changes.
- **Staff create shifts, members claim.** No proposal state.
- **Feedback is keyed to the signup**, one per signup.

## Step 1 — Schema

- [x] `schema/volunteer.ts` — 6 tables, types, zod schemas
- [x] `volunteer_role` — `defaultDurationMinutes`, `defaultCapacity`
- [x] `volunteer_hour_log.shiftId` — bare text column becomes a real FK
- [x] `src/lib/config.ts` — `volunteerSignupStatuses`,
      `CERT_EXPIRY_WARNING_DAYS = 60`, shift/feedback limits
- [x] `schema/index.ts`, `schema/relations.ts`
- [x] `scripts/d1-table-order.mjs` — parents before children
- [x] (user runs `pnpm db:generate`) — migration 20260811204457_magenta_paibok

## Step 2 — Certifications

- [x] `volunteer-certification-service.ts` — catalog CRUD, archive/restore,
      in-use delete guard (copy `volunteer-role-service.ts`)
- [x] `member-certification-service.ts` — grant, revoke, derived state,
      `heldOn(userId, certId, date)`, same-day typo delete
- [x] `/staff/volunteer/certifications` — catalog table
- [x] Clearances view — current / expiring / lapsed
- [x] Role edit form — required-certifications picker (CheckboxGroup, not
      TagInput: TagInput's encoding doesn't match an array field)
- [x] `staff/users/[id]` — Certifications card, Grant + Revoke actions
- [ ] `/member/volunteer` — Certifications block
- [x] Review queue — advisory glyph when the role required a cert the member
      did not hold on the date worked

## Step 3 — Shifts

- [x] `volunteer-shift-service.ts` — create/duplicate/edit/cancel, list open,
      claim counts
- [x] `volunteer-signup-service.ts` — claim (capacity + clearance + dup guards),
      cancel, confirm, no-show
- [x] `/staff/volunteer/shifts` — list with needed-vs-claimed, filters
- [x] `/staff/volunteer/shifts/[id]` — claimants, confirm, no-show
- [x] `/member/volunteer` — Open Shifts block, interest-first ordering, and an
      unclaimable shift says _why_ rather than hiding
- [x] Staff nav `childHrefs` + `Nav.Item`, queue header buttons

## Step 4 — Crons, notifications, hour-log join

- [x] `/api/cron/shift-reminders` — daily batch, confirmed signups for tomorrow
- [x] `/api/cron/complete-shifts` — 15-min group, confirmed past `endsAt`
- [x] `/api/cron/shift-feedback` — daily batch, yesterday's completed signups
- [x] `CRON_SCHEDULE` **and** the `wrangler.toml` comment — hand-synced, keep both
- [x] 3 domain events, 3 `NOTIFICATION_TYPES`, 3 listeners (generic alias)
- [x] Completed signup pre-fills an hour log; queue marks scheduled logs

## Step 5 — Feedback

- [x] `volunteer-feedback-service.ts` — submit once per signup, read for staff
- [x] Member form from the notification (Bits UI `RatingGroup`)
- [x] Staff: per-shift responses and the per-role aggregate

## Step 6 — Seeds, tests, docs

- [x] `scripts/seed-dev.ts` — catalog with one expiring + one lapsed card,
      shifts either side of today, signups across every status, feedback on the
      completed ones
- [~] Specs: date asymmetry **done**, renewal appends, claim refusals (full / uncleared /
  duplicate), completion only touches confirmed-and-past, feedback once
- [x] Extend `e2e/volunteering.e2e.ts` + its fixture — shifts and feedback (15 tests)
- [x] Spec — rewrite §Phase 2 and §Certifications from "designed" to shipped
- [x] `production-workflow-spec.md:1256` — close the staffing hook
- [x] Help articles, `docs/manual/README.md`, `pnpm docs:routes`,
      `pnpm docs:check`, feature-catalog row + table count 32 → 38

## Step 7 — The event link (follow-up)

`volunteer_shift.eventId` shipped in Step 1 and stayed unreachable: no form ever
rendered a field for it, so every shift in production was unattached and the
`leftJoin` that surfaces `eventTitle` had nothing to surface.

- [x] `searchEvents` — staff event picker query, nearest-in-time first, cancelled
      and rejected excluded, community drafts excluded (inherited from `listAll`)
- [x] `listShifts({ eventId })` + `getShiftDetail(id)` — the latter gives the
      detail page `roleName` / `eventTitle` / `claimed` in one read, without
      widening `getShiftById`, which the signup service branches on
- [x] `ShiftFormFields.svelte` — the field set was already duplicated across two
      modals before this added two more call sites
- [x] Shift detail page — an **Edit** action, wiring up `updateShift`, which had
      been written and had no caller. Until now a shift could only be created,
      copied, or called off.
- [x] `/staff/events/[id]` — a Volunteer Shifts card, always rendered, with a
      Schedule action prefilled from doors and the event locked in
- [x] `toLocalDateTime` in `$lib/utils/format` — the third copy of the same
      club-time datetime-local helper was about to be written
- [x] Seeds + e2e fixture link shifts to shows; 3 e2e tests, 4 service specs, 6
      `searchEvents` specs

**The trap, if this is ever touched again:** the picker's hidden input is
rendered even with nothing selected. `updateShift` writes `eventId` only when
the key is _present_, so absent means "untouched" and empty means "cleared".
`SearchSelect`'s own `name` prop emits the input only while something is picked,
which makes detaching a silent no-op that still reports success. `readShiftEventId`
in the e2e fixture exists because the page shows the stale value only on reload.

## Verification notes

- The Browser pane won't hold a better-auth session — its cookie jar drops it,
  and a cached SSR page masks that as a 401 on the next POST rather than a
  visible logout. Verify signed-in flows with Playwright, not the pane.
- `e2e/volunteering.e2e.ts` now covers the shift board: claim, drop out (and the
  place reopening), the clearance refusal naming what's missing, a full shift,
  and staff confirming a claim. 13 tests, ~55s.

## Gotchas carried from Phase 1

- Remotes live in `src/lib/remote/`, not colocated.
- Guard inside the remote handler — remote functions bypass route/layout loads
  and take params from a client header.
- No `db.transaction()` (lint rule). Guard-then-insert and let unique indexes be
  the backstop.
- Chunk multi-row inserts — D1 caps a statement at 100 bound parameters.
- `refresh()` is keyed by argument: refresh the arg-keyed query from the page,
  not an argless one from the remote.
- Every user-facing validation rule needs written copy, or staff see raw zod.
- Markdown descriptions render through `renderMarkdown` in the remote, never
  `sanitizeBio`.
- URL filter state: local `$state` + `goto(replaceState: true)`, never
  `replaceState()`. Name the search binding `searchText` — a `search` snippet
  shadows it.
- Dates that are calendar dates anchor at **noon** club time.
- daisyUI `.select` goes on a wrapper — use `Form/Select.svelte`.
