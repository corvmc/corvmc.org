# Volunteering module Phase 1 — progress checklist

Design: `docs/specs/shipped/volunteering-spec.md`. Plan: `~/.claude/plans/investigate-current-plans-for-cheeky-wave.md` (approved).
Branch: `claude/volunteer-system-plans-5b2b17` (off `main`).

## Model recap

- Two tables. `volunteer_role` = staff-managed job type (unique name, markdown
  description, displayOrder, isActive). `volunteer_hour_log` = one member's claim
  of time in one role on one day.
- Statuses `pending | approved | rejected`. Withdrawal is a **hard delete** of a
  pending log by its owner, not a fourth status.
- Role FK is `ON DELETE RESTRICT`. Retire via archive (`isActive = false`), which
  hides a role from the **member submit form only** — staff filters and reports
  still show it.
- Active-role check applies **on submit, not on approve** — archiving a role
  mid-review must not strand queued logs.
- `workedOn` anchored at **noon** club time (`buildDateInTz(d, '12:00', TZ)`). The
  report buckets months in UTC; noon local is mid-day UTC at any offset. Midnight
  local would also work for the Americas but breaks for UTC-ahead zones — noon
  removes the class of bug. Pinned by a test.
- Minutes as integers, never floats. UI takes quarter-hours.
- **No credit tie-in.** Approving writes no `credit_transaction`; there is a test.
- Phase 2 (shifts/sign-up) designed in the spec, not built. `shiftId` is a bare
  text column, not an FK — the target table doesn't exist.

## Step 1 — Design spec

- [x] `docs/specs/shipped/volunteering-spec.md`
- [x] `IDEAS.md` — `**Progress:**` line under Volunteer Coordination
- [x] `docs/README.md` — spec table row
- [x] this checklist

## Step 2 — Schema + feature flag

- [x] `src/lib/server/db/schema/volunteer.ts` — both tables, types, zod schemas
- [x] `src/lib/config.ts` — `volunteerHourStatuses`, limits, `formatVolunteerHours()`
- [x] `src/lib/server/db/schema/index.ts` — export line
- [x] `src/lib/server/db/schema/relations.ts` — `volunteerHourLog` block
- [x] `scripts/d1-table-order.mjs` — `volunteer_role` then `volunteer_hour_log`
- [x] Feature flag, 4 sites: `site-config-service.ts` DEFAULTS, `feature-flags.ts`
      (union **and** `ALL_FLAGS`), `settings.remote.ts` `VALID_FLAGS`,
      `staff/settings/+page.svelte` `featureMeta`
- [x] Fold in the `contentFlags` bug fix — `VALID_FLAGS` omits it today, so the
      existing Content Flags toggle 400s. Collapse `VALID_FLAGS` to `ALL_FLAGS`.
- [x] (user generates the drizzle migration with `pnpm db:generate`)

## Step 3 — Services

- [x] `volunteer-role-service.ts` — CRUD, archive/restore, delete guard
      (`VolunteerRoleInUseError`, mirroring `deleteCategory`)
- [x] `hour-log-service.ts` — submit/edit/withdraw/approve/reject + queries
- [x] `volunteer-report-service.ts` — totals, by member, by role, by month
- [x] `src/lib/server/event-bus/event-bus.ts` — 2 payload types, 3 event keys
- Errors extend `DomainError` — no edit to `errors.ts` needed.
- No `db.transaction()` (lint rule); every mutation is a single statement.
- `getHoursByMember` count query must be `count(distinct user_id)`, not `count()`
  — `paginate()` would otherwise inflate `totalPages` under `GROUP BY`.

## Step 4 — Routes, remotes, notifications

- [x] `src/lib/remote/volunteer.remote.ts` (all 22 remotes live in `src/lib/remote/`,
      **not** colocated — CLAUDE.md is stale on this)
- [x] `/member/volunteer` — role cards w/ `ProseBlock`, my hours, Log Hours modal
- [x] `/staff/volunteer` — TabBar + FilterBar + DataList queue
- [x] `/staff/volunteer/roles` — role CRUD table
- [x] `/staff/volunteer/report` — StatCards + 3 rollup tables
- [x] `StatusBadge.svelte` — `approved`/`rejected` in **both** maps
- [x] staff + member `+layout.svelte` nav (flag-gated), staff pending badge
- [x] `schema/notification.ts` — 3 `NOTIFICATION_TYPES`
- [x] `notification-listeners.ts` — 3 listeners + `formatHours()`
- UI gotchas: URL filter state via `goto(replaceState)` not `replaceState()`;
  daisyUI `.select` on the wrapper (use `Form/Select.svelte`); name the search
  binding `searchText` (a `search` snippet would shadow it).

## Step 5 — Seed

- [x] `scripts/seed-dev.ts` — imports, `deleteAll()` (child before parent),
      `seedVolunteerRoles()` (6-8 w/ real markdown descriptions, one archived),
      `seedVolunteerHours()` (~50 rows: ~10 pending, ~36 approved, ~4 rejected)
- [x] `batchInsert(volunteerHourLog, values, 7)` — 13 cols × default 10 rows = 130
      bound params, over D1's 100 ceiling

## Step 6 — Tests

- [x] `volunteer-role-service.spec.ts` — dup name, in-use delete guard, archive
- [x] `hour-log-service.spec.ts` — validation limits, archived-role submit vs
      approve asymmetry, already-reviewed guard, owner guards, LIKE escaping
- [x] **`approveHourLog` writes no `credit_transaction`** — the load-bearing test
- [x] `volunteer-report-service.spec.ts` — approved-only, distinct-user count,
      archived roles still resolve
- [x] `StatusBadge.spec.ts` vocabulary + `notification-listeners.spec.ts`

## Step 7 — Verify

- [x] `pnpm check`, `pnpm test:unit --run`, `pnpm lint:changed`
- [x] `pnpm db:generate && pnpm db:migrate && pnpm db:seed`
- [x] Feature flag enabled in local KV (`site-config:feature.volunteering`)
- [x] All four routes resolve and 302 anonymous users to `/login`
- [x] Noon anchoring verified against real seeded rows in D1 (see NOTE below)
- [x] Browser QA of the signed-in pages (partial, in the Browser pane)
- [x] `e2e/volunteering.e2e.ts` + `e2e/fixtures/seed-volunteering.ts` — authenticates
      with its own seeded fixture, so this no longer needs a human in the loop.
      Wired into `e2e/global-setup.ts`; the fixture also flips the KV feature flag.

## Step 8 — Document

- [x] `docs/reports/feature-catalog.md` — **5** touch points: lines 33, 61, 142, 158,
      and 213 + 269 (table count 29 → 31)
- [x] Help articles under `src/content/help/volunteering/`, indexed in
      `docs/manual/README.md`
- [x] `pnpm docs:routes`, commit `docs/manual/route-inventory.json`

## Bugs found by QA (all fixed)

1. **Approving did not refresh the queue.** `refresh()` is keyed by argument, so
   `getStaffVolunteerLogs({}).refresh()` in the remote updated the argless tab
   counts while the arg-keyed table kept rendering the row just approved. Pages
   now refresh their own arg-keyed queries (`onsuccess` on /staff/volunteer,
   `onMount` on the report). Pinned by an e2e test.
2. **Raw zod text shown to staff.** A rejection with no reason rendered "Too
   small: expected string to have >=1 characters". Every user-facing rule now
   carries written copy. Pinned by an e2e test.
3. **Job descriptions rendered as literal markdown.** The member page ran the
   description through `sanitizeBio`, an HTML sanitizer, so `**bold**` showed
   its asterisks. Now rendered with `renderMarkdown` in the remote function,
   which also keeps `marked`/`xss` out of the client bundle. Pinned by an e2e test.
4. **A member could not log hours for today before noon.** `workedOn` is pinned
   to noon club time and the future check compared that instant against `now`,
   so all morning "today" read as a future date. Both date rules now compare
   calendar dates in club time. The member form's default date had the mirror
   flaw — it used the UTC date, which from 5pm PT is already tomorrow; it now
   uses `clubToday()`. Every unit test used a past date, which is why this
   survived to the e2e run. Pinned by "accepts today, at any hour of the day".
5. **`VALID_FLAGS` drift** (pre-existing, unrelated): omitted `contentFlags`, so
   the settings toggle 400'd. Collapsed to `ALL_FLAGS` + `feature-flags.spec.ts`.

## Filed separately (out of scope)

- **Nested `<button>` from `Button`'s tooltip wrapper.** Any `Button` with a
  `title` wraps itself in a bits-ui `Tooltip.Trigger`, which is itself a
  `<button>` — so every icon-only `Action` renders invalid nested buttons that
  vanish from the accessibility tree. Pre-existing; also affects
  /staff/reservations and /staff/recurring. The e2e selectors work around it by
  targeting `button[data-button-root]`.
- **`content_flag` missing from `scripts/d1-table-order.mjs`.**

## Post-merge with main (Aug 8)

Merged `origin/main` (4 commits). Two of them changed things this module had
already assumed:

- **#171 made the staff panel flag-independent** — flags now gate the member,
  band and public surfaces only, so staff can run a feature before it is switched
  on. Applied here: dropped `requireFeature('volunteering')` from all 12
  staff-side remotes (6 member-side ones keep it), removed the flag gate from the
  staff nav, and made `volunteerPending` always compute. The member nav and member
  remotes are unchanged.
- **#175 fixed the nested-button defect** this module reported, so icon-only
  actions are no longer a `<button>` inside a `<button>`. The e2e selectors target
  `button[data-button-root]`, which works either way.
- **#174 added `content_flag` to `d1-table-order.mjs`** — the other issue this
  module filed. Merged alongside `volunteer_role` / `volunteer_hour_log`.

Conflicts resolved in `staff/+layout.svelte`, `layout.remote.ts`,
`d1-table-order.mjs` and `Action.svelte` (main's phrasing of the `.for()` type
comment kept; the widened type was already identical).

## Step 9 — Commit

- [x] "Add volunteer roles and hour logging with a staff approval queue and report."
      No co-author line.

## NOTEs

- The original rationale for noon anchoring was **wrong** and is corrected in the
  spec and code comments. Midnight-local does NOT slip the month bucket for the
  Americas (00:00 PT = 07:00 UTC, same day). It slips only for UTC-**ahead**
  zones, where midnight local is the previous UTC day. Noon is still correct —
  it holds for any offset −11..+11 — but it is a robustness choice, not a bug
  fix. Verified against seeded rows and pinned by
  `hour-log-service.spec.ts` ("anchors workedOn at 12:00 club time").
- `Action` in form-modal mode needs the **`form`** snippet, not `body`:
  `{#if body}` short-circuits before the RemoteForm branch, so a `body` snippet
  renders the fields with no `<Form>` wrapper and no submit button. `ui-patterns.md`
  documented `body` and has been corrected, including a mode table row for the
  broken combination.
- `Action`'s `action` prop type rejected `.for()` instances (`Omit<RemoteForm,'for'>`)
  even though `ui-patterns.md` documents that usage — the type is now widened.
- `MemberLink` takes `member={{...}}`, not `name`/`email`/`userId` props;
  `ui-patterns.md` is stale on this (not corrected — out of scope).
- `hourLogSelect` had to become a **function**: as a module-level const it called
  `primaryRoleFor()` at import time, which broke every spec that partially mocks
  `$lib/server/authorization` once `layout.remote.ts` imported the service for
  the nav badge.
- `NavCollapsible` gained a `badge` prop mirroring `NavItem`'s, for the pending count.
- `settings.remote.spec.ts` now uses `importOriginal` so `ALL_FLAGS` stays real —
  mocking it out would defeat `feature-flags.spec.ts`'s drift guard.
