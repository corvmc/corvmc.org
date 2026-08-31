# Instructor module — progress checklist

Design: `docs/specs/instructors-spec.md`.
Plan: `~/.claude/plans/let-s-talk-about-tools-ethereal-iverson.md` (approved).
Branch: `claude/teaching-tools-ffff44` (off `main`).

## Model recap

- An **instructor** is a person CMC granted the right to rent the practice room on teaching terms.
  **CMC's relationship is with the teacher, not the student** — no enrolment, no student records, no
  minors machinery, no payouts. That one line is why this module is small.
- One table. `instructor.userId` is `NOT NULL UNIQUE FK → user`, mirroring `volunteer_profile`.
  Status `requested | rejected | active | paused | retired`.
- **The application IS the draft listing.** Staff approve exactly what they would publish. One form.
- Declining **sends it back** (`'rejected'` + `reviewNotes`) rather than deleting — this departs from
  `declineApplication()` deliberately, because a group application carries no content and this one
  does. Not an appeal: appeals contest behavior calls, and this is a judgment about a proposal.
- `requireInstructor` matches **positively** on `eq(status, 'active')`. That is what makes
  `'requested'`/`'rejected'` unable to book _by construction_.
- `bookerType` gains `'instructor'`, pointing at `instructor.id` — a real table, so the discriminator
  stays honest. Legacy `'lesson'` is **not** renamed and **not** backfilled.
- Teaching terms come from `getBookingTerms(bookerType)`, never a direct rate read. Teaching time
  does **not** consume `free_hours`.
- `teachingContact` is nullable; null falls back to `directory_entry.contact`, and the fallback runs
  through `contactForView('public', …)` so a members-only contact is withheld rather than published.
- `teachesLessons` **stays** and keeps meaning "I teach, possibly nowhere near CMC."
- **No feature flag.** The phase order carries the guarantee instead: staff-only surfaces may land
  early, member-facing surfaces may not land before the thing they advertise works.

## Blocked — resolve before Step 3

**1. The production census — still unrun, and now deliberately routed around.**
`wrangler d1 execute --remote` returns `code: 7403` from this environment. Rather than block,
Step 3 took the branch that is **correct under either outcome**: `'lesson'` stays as an
archival value and `'instructor'` takes `IconChalkboard`. If the census later shows zero
`lesson` rows, deleting the value and reclaiming `IconSchool` is a small, safe follow-up. If it
shows rows, nothing needs doing. Neither branch emits SQL.

**2. `reservation.teachingRateCents` is `500` — $5/hr, which is the rate a sustaining member's
contribution already buys.** `webhook-handlers.ts` computes it: `$5 = 1 hour = 2 credits`. So this is
not a discount, it is **the member rate with the monthly cap lifted** — the $15
`hourlyRateCents` is the drop-in rate for hours past your allocation. Two consequences for Step 5:
**credits DO apply** (the goal is extending the allocation, which presupposes spending it first, and
at $5/hr one credit covers exactly one half-hour slot), and the abuse case is far smaller than an
earlier draft claimed — an instructor rehearsing on teaching time pays what they would have paid with
credits, and gains only that their hours are uncapped.

**3. Off-peak pricing is coming and is a separate spec.** Lower prices before 4pm, for everyone. The
seam: the applicable rate is `min(bookerRate, timeRate)`, and pricing stops being `duration × rate`
because a booking spanning 4pm has two rates — that replaces the formula at 8+ sites, which the
off-peak spec owns. `commitReservationCredits` keeps its `creditsApply` parameter for it.

## Step 1 — Design spec

- [x] `docs/specs/instructors-spec.md`
- [x] `docs/plans/instructors-checklist.md` — this file
- [x] `IDEAS.md` — `**Progress:**` line under "Lessons / Teacher Panel", noting the narrowing
- [x] `docs/README.md` — spec table row

## Step 2 — Schema + service

- [x] `src/lib/server/db/schema/instructor.ts` — table, types, zod schemas. Two details taken from
      `volunteer_profile` rather than from the plan: the index is **(status, createdAt)**, not status
      alone — it is the staff review queue, oldest first — and **`updatedAt` is `notNull` with a
      `unixepoch()` default**, because this is a fresh CREATE TABLE. (`group_member`'s nullable
      `updatedAt` is an artefact of being added by ALTER, where SQLite rejects a non-constant
      default; that constraint does not apply here.)
- [x] `src/lib/config.ts` — `instructorStatuses` + labels (NOT the schema file; the staff page
      imports it, and `$lib/server` is unreachable from the browser)
- [x] `src/lib/server/db/schema/index.ts` — export line
- [x] ~~`relations.ts`~~ — **not needed.** `volunteer_profile`, the closest analogue, has no
      relations block either: drizzle relations exist for the `db.query.*` API, and this module
      uses explicit joins like the rest of the directory code. Adding an untraversed block
      would be config nothing reads.
- [x] `scripts/d1-table-order.mjs` — after `user`
- [x] `src/lib/components/ui/StatusBadge.svelte` — `paused` added to `variants` and `badgeClass`
      (`IconPlayerPause` / `badge-warning`, distinct from `retired`'s ghost archive so the staff list
      can tell "back in autumn" from "gone"). The other four were already mapped. Registered in
      `StatusBadge.spec.ts`'s `vocabularies`.
- [x] **No `instructorStatusLabels`** — `StatusBadge` flat-merges every vocabulary's labels by bare
      status string, so one here would have relabelled equipment loans' `requested` and clobbered
      `volunteerHourStatusLabels`' `rejected` → "Returned". That "Returned" is the label this module
      wanted anyway, which is also why `rejected` is the right value rather than a coined one.
- [x] `src/lib/server/instructor/instructor-service.ts` — full set including the application half,
      even though nothing calls it until Step 7
- [x] `src/lib/server/instructor/instructor-context.ts` — `requireInstructor(userId)`
- [x] Migration via `pnpm db:generate` — `CREATE TABLE` + whatever the census decided
- [x] `instructor-service.spec.ts` — runs the real statements against real SQLite over the
      committed migrations (`group-invite-upsert.spec.ts`'s approach), because every risk here
      is a WHERE clause and a mocked db would pass while matching the wrong rows. Covers
      `requireInstructor` too rather than getting its own file: the usual
      don't-merge-sibling-specs rule guards against unioning conflicting `vi.mock` preambles,
      and there is one mock here that both modules want identically.

## Step 3 — Booker type + terms (inert refactor; nothing writes the new value)

- [x] `bookerTypes` gains `'instructor'` (and loses `'lesson'` per census)
- [x] `src/lib/components/ui/entity/registry.ts` — reservation subtype + glyph
- [x] `src/lib/server/entity/refs.ts` — explicit `'instructor'` branch above the fallback
- [ ] `staffReservationFiltersSchema` — widen the `bookerType` enum (may be automatic: it likely
      derives from `bookerTypes` rather than re-listing them — check before editing)
- [x] `src/lib/server/reservation/config.ts` — `termsFor()` / `getBookingTerms()` + four
      `reservation.teaching*` defaults
- [x] `site-config-service.ts` `DEFAULTS` — the four keys **plus the missing `minAdvanceMinutes`**
- [x] `settings.remote.ts` — settings form fields
- [x] `conflict-service.ts` — `validateBooking` takes `bookerType`; `create`/`staffCreate` forward it
- [ ] **Convert the rate reads to the resolver** — each must start selecting `bookerType`.
      Measured, since the plan's "~20" was an estimate: **27 config-read sites**
      (6 `config<number>('reservation.hourlyRateCents')` + 21 `getReservationConfig()`, of which not
      all read the rate), and 44 `hourlyRateCents` mentions in `reservations.remote.ts` alone.
      Highest risk: the charge paths, the credit commit, and `getReservations` (the member's own
      list, which excludes only `'event'`, so teaching bookings would show $15/hr)
- [ ] **`src/lib/server/db/schema/api.ts` exposes `hourlyRateCents` publicly** — on
      `ReservationPayResponse` and the staff detail response. Not named in the plan and it is a
      contract, not an internal read: both must report the rate _resolved for that reservation_, or
      an API consumer is told a teaching booking costs the member rate. Check for external consumers
      before changing the meaning of the field.
- [x] `config.spec.ts` — `termsFor` is pure, so it needs no mock; pins that a _new_ booker type
      inherits member terms rather than teaching ones, and that one credit is exactly one half-hour
      of teaching
- [ ] `conflict-service.spec.ts`, `refs.spec.ts`

## Step 4 — Staff surface (staff-only; nothing member-facing)

- [ ] `src/routes/staff/instructors/+page.svelte` + Requested block
- [ ] `src/routes/staff/users/[id]/panels/InstructorPanel.svelte` — on the **`space`** tab, not a 9th
- [ ] Five `*Action.svelte`: Approve, Send back, Grant, Pause, Retire
- [ ] `src/lib/remote/instructors.remote.ts` — staff half only
- [ ] `src/routes/staff/nav-items.ts` + `nav-items.spec.ts`
- [ ] `instructors.remote.spec.ts` (staff half)

## Step 5 — Booking path

- [ ] `bookInstructorReservation` in `reservations.remote.ts`
- [ ] `commitReservationCredits` gains `creditsApply` — **defect fix**, would otherwise spend the
      instructor's free hours
- [ ] `CreateModal.svelte` — booking-type step, shown only to instructors
- [ ] `deactivateUser` — second arm on `createdByUserId` — **defect fix**
- [ ] `reservations.remote.instructor.spec.ts`, `reservation-credit-service.spec.ts`
- [ ] `e2e/instructor-booking.e2e.ts`

## Step 6 — Recurring

- [ ] `generationWindowEnd(from, bookerType)`; `processSeries` passes `prototype.bookerType`
- [ ] Recurring branch with **no** sustaining-membership gate
- [ ] `cancelAllForUser` scoped to `booker_type = 'user'` — **defect fix**, an instructor whose
      membership lapses would otherwise silently lose their standing slots
- [ ] `generation-job.spec.ts`, `recurring-series-service.spec.ts`

## Step 7 — Going public: listing + applications

- [ ] `src/routes/(public)/directory/instructors/+page.svelte`
- [ ] `src/routes/member/directory/instructors/+page.svelte`
- [ ] `src/lib/components/directory/InstructorCard.svelte`
- [ ] Third `TabBar` tab on both directory roots
- [ ] `instructor-directory-service.ts` — **three gates**: `status = 'active'`,
      `directory_entry.visibility`, `contactForView` over the resolved contact
- [ ] `/member/profile` — the five-state card, `teachingContact` editor, members-only-contact nudge
- [ ] `instructors.remote.ts` — member half
- [ ] Three notification listeners: submit → staff, approve → member, send back → member
- [ ] `teachesLessons` copy rename → "Teaches privately" across 7 sites
- [ ] `src/content/help/` article
- [ ] **`instructor-directory-service.spec.ts` — the exposure test**
- [ ] `e2e/instructor-application.e2e.ts`

## Step 8 — Seed, docs, close out

- [ ] `scripts/seed-dev.ts` — 2 active with bookings, 1 paused, 1 requested, 1 rejected w/ notes
- [ ] `docs/reports/feature-catalog.md` row
- [ ] `pnpm docs:routes && pnpm docs:check`
- [ ] Move spec to `docs/specs/shipped/`, update `docs/README.md`

## Gates

`pnpm check` · `pnpm test:unit -- --run` · `pnpm lint` before every commit.
Schema steps: **`pnpm db:reset` alone** — it already migrates _and_ seeds, so the
`db:reset && pnpm db:seed` that CLAUDE.md and conventions.md both tell you to run seeds twice
and dies on `UNIQUE constraint failed: media.key`. Then check child row counts.
Regenerate migrations via `pnpm db:generate` after merging `main` — never by hand.
