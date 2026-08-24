# Spec Audit

Last updated: 2026-08-23 · audited at `9eb95cb`

`docs/README.md` calls `docs/specs/` "the source of truth for how a feature behaves." For most of
the folder that is no longer what it is. Of 31 specs, **23 describe behavior that is fully shipped**
— they are documentation wearing a spec's clothes — **1 is half-shipped**, and only **7 still
describe something that does not exist**.

The cost of leaving them mixed together is not tidiness. A spec that shipped and then drifted asserts
the opposite of the code with the authority of a source of truth: `volunteering-spec.md` still says
Phase 2 and certifications are "**not built**" while six tables, five routes and three crons
implement them. Anyone reading the folder to learn how the system works cannot tell which half they
are in.

This audit classifies all 31, names where each shipped spec's content should land, and lists every
stale or overlapping reference found in `CHORES.md`, `IDEAS.md`, `docs/README.md` and the reports.

**What this pass did:** the audit itself, plus every correction in §3–§5. **What it did not do:** the
physical transition — folding shipped specs into `business-workflows.md`, writing the missing manual
articles, and moving files into `docs/specs/shipped/`. §6 sequences that.

---

## 1. Inventory

Status is read from the code, not from the spec. **Shipped** means the described behavior is present
in tables, routes and services; it does not mean every deferred idea inside the document was built
(each such carve-out is noted).

### Shipped — 23

| Spec                                                                                    | PRs              | Evidence in the tree                                                                                                                                                                  | Doc destination                                    |
| --------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| [reservation-system-spec.md](../specs/shipped/reservation-system-spec.md)               | #78              | `reservation` table, `/member/reservations/*`, `reservation-service.ts`, lock integration                                                                                             | business-workflows §1 (already linked)             |
| [recurring-reservations-spec.md](../specs/shipped/recurring-reservations-spec.md)       | #78              | `recurring_series`, `/staff/recurring`, `generate-recurring-reservations` cron                                                                                                        | business-workflows §2 (already linked)             |
| [staff-reservations-spec.md](../specs/shipped/staff-reservations-spec.md)               | #78              | `/staff/reservations`, `/staff/reservations/[id]`, resolve + create modals                                                                                                            | business-workflows §1 — needs a staff subsection   |
| [bands-spec.md](../specs/shipped/bands-spec.md)                                         | #78, #241        | `band`, `band_member`, `band_slug_history`, `/band/[slug]/*`                                                                                                                          | business-workflows §4 (already linked)             |
| [staff-bands-spec.md](../specs/shipped/staff-bands-spec.md)                             | #78              | `/staff/bands`, `/staff/bands/[id]`, tier comp/revoke                                                                                                                                 | business-workflows §4 (already linked)             |
| [tickets-spec.md](../specs/shipped/tickets-spec.md)                                     | #78              | `ticket` table, `/events/[id]/tickets`, `/staff/events/[id]/check-in`                                                                                                                 | business-workflows §5 (already linked)             |
| [directory-profiles-spec.md](../specs/shipped/directory-profiles-spec.md)               | #78              | `user_instrument`, `user_genre`, `band_genre`, `/directory/*`, `/member/profile`                                                                                                      | manual — `profile-directory` (7 articles, covered) |
| [membership-page-spec.md](../specs/shipped/membership-page-spec.md)                     | #78              | `/member/membership`, `subscription-service`, `credit_transaction`                                                                                                                    | business-workflows §3 (already linked)             |
| [member-dashboard-spec.md](../specs/shipped/member-dashboard-spec.md)                   | #78              | `/member` landing page                                                                                                                                                                | manual — `getting-started` (covered)               |
| [email-marketing-spec.md](../specs/shipped/email-marketing-spec.md)                     | #78, #185        | `audience`, `campaign`, `subscriber`, `/staff/marketing/*`, `send-campaigns` cron                                                                                                     | business-workflows §7 (already linked)             |
| [finance-spec.md](../specs/shipped/finance-spec.md)                                     | #78, #131        | `payment_cache`, `credit_transaction`, Stripe-first payment service                                                                                                                   | business-workflows §3 + architecture/overview      |
| [member-standing-spec.md](../specs/shipped/member-standing-spec.md)                     | #224             | `member_standing` table; the three per-domain tables are gone                                                                                                                         | **new** business-workflows §Moderation             |
| [member-portal-chat-spec.md](../specs/shipped/member-portal-chat-spec.md)               | #204, #234       | `inbox_participant`, `/member/messages`, `portal` channel                                                                                                                             | **new** business-workflows §Messaging              |
| [direct-messages-spec.md](../specs/shipped/direct-messages-spec.md)                     | #213, #224, #234 | `user_block`, `user.acceptsDirectMessages`, `direct-service.ts`                                                                                                                       | **new** business-workflows §Messaging              |
| [member-suggestions-spec.md](../specs/shipped/member-suggestions-spec.md)               | #212, #217, #224 | `suggestion`, `suggestion_vote`, `suggestion_edit`, `/member/suggestions`, `/staff/suggestions`                                                                                       | **new** business-workflows §Moderation             |
| [community-calendar-spec.md](../specs/shipped/community-calendar-spec.md)               | #145 → #207      | `/events` gig guide, `event.source`, `idx_event_source`                                                                                                                               | **new** business-workflows §Gig guide              |
| [community-events-spec.md](../specs/shipped/community-events-spec.md)                   | #207, #224, #241 | `source='community'`, `/member/events/submit`, cancelled-not-hidden                                                                                                                   | **new** business-workflows §Gig guide              |
| [event-lineup-spec.md](../specs/shipped/event-lineup-spec.md)                           | #197             | `event_band` table, confirm/decline slot, `/band/[slug]/events`                                                                                                                       | **new** business-workflows §Gig guide              |
| [event-moderation-spec.md](../specs/shipped/event-moderation-spec.md)                   | #146, #197, #207 | `'event'` in `flagEntityTypes` ([flag.ts:12](../../src/lib/server/db/schema/flag.ts:12)), `/staff/flags`                                                                              | **new** business-workflows §Moderation             |
| [band-domains-spec.md](../specs/shipped/band-domains-spec.md)                           | #183, #186       | `band.customDomain*` columns ([band.ts:98](../../src/lib/server/db/schema/band.ts:98)), `/band-site/[slug]`                                                                           | business-workflows §4                              |
| [band-sites-launch.md](../specs/shipped/band-sites-launch.md)                           | #152             | Shipped and then **superseded** by `band-domains-spec.md`                                                                                                                             | archive only — no fold                             |
| [staff-user-detail-context-spec.md](../specs/shipped/staff-user-detail-context-spec.md) | #164, #211, #233 | 8 tabs in [tabs.ts](../../src/routes/staff/users/[id]/tabs.ts), 9 panel components                                                                                                    | manual — `staff-guide`                             |
| [volunteering-spec.md](../specs/shipped/volunteering-spec.md)                           | #177 → #235      | **Phase 1 _and_ Phase 2 _and_ certifications.** 9 tables, `/staff/volunteer/{roles,shifts,certifications,clearances,report}`, `/member/volunteer/{start,interests,feedback}`, 3 crons | **new** business-workflows §Volunteering           |

Carve-outs deliberately left unbuilt inside otherwise-shipped specs: staff impersonation
(`staff-bands-spec.md`), partner feed imports and `.ics`/RSS syndication (`community-calendar-spec.md`).

### Partial — 1

| Spec                                                                                     | Shipped                                                                                                                                                                                                                                                  | Not shipped                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [reservation-confirmation-window.md](../specs/reservation-confirmation-window.md) (#125) | Phase 1 — `CONFIRMATION_WINDOW_DAYS` ([config.ts:98](../../src/lib/config.ts:98)); Phase 2 — `cancelUnconfirmedReservations` ([reservation-service.ts:380](../../src/lib/server/reservation/reservation-service.ts:380)) + the `cancel-unconfirmed` cron | **Phase 3, door-code timing.** `provisionDailyAccess` ([lock-service.ts:39](../../src/lib/server/lock/lock-service.ts:39)) still queries one day (`dayStart`/`dayEnd`), not the 3-day window; nothing mints a `lockCode` on confirm |

This one splits at the transition: the shipped half folds into business-workflows §1, the Phase 3
paragraph stays behind as a spec.

### Designed, not built — 7

These stay exactly where they are. Every one was checked against the tree, not against its own claim.

| Spec                                                                  | PRs         | Verified absent                                                                                                                                                              |
| --------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [groups-spec.md](../specs/groups-spec.md)                             | #176 → #247 | No `group`, `directory_entry`, `band_site` or `contact` table. Only the slug reservation exists ([reserved-slugs.ts:58](../../src/lib/reserved-slugs.ts:58))                 |
| [production-workflow-spec.md](../specs/production-workflow-spec.md)   | #158 → #245 | No `production`, `production_slot`, `venue` or `production_expense` table                                                                                                    |
| [moderation-appeals-spec.md](../specs/moderation-appeals-spec.md)     | #217        | No `moderation_appeal` table; `setStanding` still takes `flagId` as optional                                                                                                 |
| [audit-log-spec.md](../specs/audit-log-spec.md)                       | #164        | No audit table and no `auditLog` symbol anywhere in `src/`                                                                                                                   |
| [admin-vs-staff-spec.md](../specs/admin-vs-staff-spec.md)             | #164        | No `requireAdmin`. `'admin'` still appears only paired with `'staff'` in [authorization.ts](../../src/lib/server/authorization.ts)                                           |
| [staff-email-change-spec.md](../specs/staff-email-change-spec.md)     | #164        | No email-change path in [users.remote.ts](../../src/lib/remote/users.remote.ts)                                                                                              |
| [reactivation-restore-spec.md](../specs/reactivation-restore-spec.md) | #164        | [`reactivateUser`](../../src/lib/server/user/user-service.ts:159) still only clears `deletedAt` — it restores neither the cancelled reservations nor the Stripe subscription |

Five of the seven (`audit-log`, `admin-vs-staff`, `staff-email-change`, `reactivation-restore`,
`staff-user-detail-context`) came out of one PR, #164, closing the follow-ups in
[staff-user-management-audit.md](staff-user-management-audit.md). Only the fifth was ever built.

---

## 2. The transition — done

The agreed shape was **fold and archive**: behavior moves into the documentation meant to carry it,
and the spec file relocates to `docs/specs/shipped/` rather than being deleted, so the design
rationale — the "why we rejected the other option" that no manual article will ever hold — survives.

That is now complete. `docs/specs/` holds 8 files: the 7 unbuilt designs, plus Phase 3 of the
confirmation window. `docs/specs/shipped/` holds the other 23.

### Where the behavior went

**business-workflows.md grew from 8 sections to 12.** The eight that existed already linked their
specs (reservations, recurring, membership, finance, bands, staff-bands, tickets, email-marketing)
and §1 gained a **staff side** subsection for `staff-reservations-spec`. Four domains had no section
at all and now do:

| New section                                                 | Folds in                                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| §9 The gig guide and community listings                     | `community-calendar`, `community-events`, `event-lineup`, `event-moderation` |
| §10 Messaging: portal threads and direct messages           | `member-portal-chat`, `direct-messages`                                      |
| §11 Moderation: reports, standing, and the suggestion board | `member-standing`, `member-suggestions`, the flag queue                      |
| §12 Volunteering                                            | `volunteering`, both phases                                                  |

**The user manual gained 5 articles and 2 categories.** The first pass of this audit claimed four
member surfaces had no coverage. Reading the articles rather than counting them corrected two of
those:

- ~~Community-event submission~~ — **already covered**, and well, by
  `events-tickets/member-events.md`, including the review path an upheld report puts you on.
- ~~Volunteering~~ — **already covered**. Two articles, but between them they carry both phases:
  shifts, clearances and the day-after survey are all there. File count was the wrong measure.

The other three were real. Five articles close them — messaging needed two, and moderation needed
a member-facing half and a staff-facing one:

| Article                                     | Category         | Closes                         |
| ------------------------------------------- | ---------------- | ------------------------------ |
| `messaging/messages-overview.md`            | **new** category | `/member/messages`             |
| `messaging/direct-messages.md`              | **new** category | the consent model, blocks      |
| `suggestions/suggestions-overview.md`       | **new** category | `/member/suggestions`          |
| `getting-started/reporting-and-standing.md` | existing         | reporting, and scoped standing |
| `staff-guide/staff-moderation.md`           | existing         | `/staff/flags`, the idea board |

The two new categories are seeded in `scripts/seed-dev.ts`. Adding them surfaced a defect worth its
own note: `src/routes/member/help/+page.svelte` mapped 8 icon names while the seed used 10, so
`user`, `layout`, `package`, `heart` and `heart-handshake` all silently fell back to the book icon —
half the help centre wearing one icon. The map now covers every seeded value and carries a comment
saying to keep the two lists in step.

### Inbound references, rewritten

All ~40 in one pass, and every relative link in every tracked markdown file was verified to resolve
afterwards:

- **5 code comments** naming a spec path — [directory-service.ts:175](../../src/lib/server/directory/directory-service.ts:175), [event-service.ts:944](../../src/lib/server/event/event-service.ts:944), [standing-service.ts:172](../../src/lib/server/moderation/standing-service.ts:172), [moderation-service.ts:116](../../src/lib/server/moderation/moderation-service.ts:116), [direct-messages.remote.ts:315](../../src/lib/remote/direct-messages.remote.ts:315). [reserved-slugs.ts:58](../../src/lib/reserved-slugs.ts:58) points at `groups-spec.md`, which did not move.
- **1 user-visible string** — [staff/users/+page.svelte:215](../../src/routes/staff/users/+page.svelte:215) named `staff-bands-spec.md` in rendered copy.
- **Docs** — business-workflows.md, both volunteering checklists, `docs/reports/{parity-report,revenue-audit,staff-user-management-audit}.md`, `docs/manual/README.md`, `docs/README.md`, `IDEAS.md`.
- **Specs citing each other across the split** — a shipped spec pointing at an unbuilt one now
  climbs out (`../groups-spec.md`); an unbuilt one pointing at a shipped one goes down
  (`shipped/bands-spec.md`). Same-side links were left alone, since they moved together.

The link sweep also turned up 25 broken links that predate this work — `component-style-audit.md`
and `sentry-triage.md` both linked source files with a prefix that resolved inside `docs/` — fixed
in passing.

---

## 3. Stale claims — corrected in this pass

Four documents asserted things the code contradicts. All four are fixed as part of this audit.

| Where                                               | Claimed                                                                      | Actually                                                                                                                                                                                                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/specs/shipped/volunteering-spec.md` §intro    | Phase 2 and certifications are "**not built**"                               | Both shipped in #235. `volunteer_shift`, `volunteer_signup`, `volunteer_shift_feedback`, `volunteer_certification`, `member_certification`, `volunteer_role_certification` all exist; `docs/plans/volunteering-phase-2-checklist.md` is 41 of 42 checked |
| `docs/specs/shipped/volunteering-spec.md` §hour log | `shiftId` is "a bare text column, not a foreign key" and "always null today" | It is a real FK with `onDelete: 'set null'` ([volunteer.ts:342](../../src/lib/server/db/schema/volunteer.ts:342))                                                                                                                                        |
| `docs/reports/parity-report.md` item 8              | Volunteering Phase 2 "designed … but not built"                              | Same error. Its `Last updated` predated #235, #245 and #247                                                                                                                                                                                              |
| `docs/README.md` volunteering row                   | "shifts + certifications designed, unbuilt"                                  | Same error, third copy                                                                                                                                                                                                                                   |

All three volunteering errors are one PR's un-swept wake: #235 shipped the feature and updated
neither the spec's own intro nor the two documents that quote it.

`docs/README.md` was also structurally behind:

- **14 of 31 specs missing** from the index — `admin-vs-staff`, `audit-log`, `band-domains`, `band-sites-launch`, `community-calendar`, `community-events`, `event-lineup`, `event-moderation`, `member-suggestions`, `moderation-appeals`, `reactivation-restore`, `reservation-confirmation-window`, `staff-email-change`, `staff-user-detail-context`
- **3 of 5 reports missing** — `revenue-audit`, `sentry-triage`, `staff-user-management-audit`
- **2 of 11 plans missing** — both volunteering checklists
- **`docs/checklists/` absent entirely** — two files, neither indexed

It now lists all of them, with a **Lifecycle** column that carries the marking from §1. That column
is the only place a spec's transition status is recorded — deliberately not a header block in each of
23 files, which is 23 places to drift.

---

## 4. `CHORES.md`

**Two entries were already done** and are moved to `## Done`:

- **`ConfirmReservationAction.svelte` imports from `routes/`** — it does not any more. Lines 6–7 now
  read `../reservations/booking/ConfirmStep.svelte` and `PaymentStep.svelte`, which is exactly the
  move the chore asked for.
- **`src/stories/` is unmodified Storybook scaffolding** — the directory no longer exists.

**One stale reference:** the "no platform ban, only deactivation" entry cites "a `messaging_standing`
ladder." That table was merged into `member_standing` by #224; only a comment in
[direct-service.ts:83](../../src/lib/server/inbox/direct-service.ts:83) still names it. Corrected to
name the scoped table.

**One overlap worth stating out loud:** the band-ownership entry proposes deriving ownership from
`band_member` and deleting `band.ownerId`. `groups-spec.md` proposes replacing the `band` table
outright, splitting it into `group` + `directory_entry` + `band_site`. Neither document mentions the
other, so the chore reads as a safe standalone refactor when it is really a bet on whether groups
lands first. Cross-linked in both directions.

**Verified still open** (checked against the tree, not assumed): the four duplicate component pairs
(`FreeformTagInput` vs `Form/TagInput`, `ProfileLinks` vs `profile/LinksBox`, both `reservations/`
directories, the unimported `member/membership/index.ts` barrel); the two tab systems (`TabBar.svelte`
vs [layout.css:439](../../src/routes/layout.css:439)); volunteer-interest search (no `interest`
reference anywhere under `/staff/users`); and the notification-content, staff-inbox-author,
subscriber-linking, conflict-warning, band-reservation-detail, two-card and timezone entries.

---

## 5. `IDEAS.md`

**Volunteer Coordination — Progress was wrong.** It described Phase 2 and certifications as
"designed there but deferred." Both shipped. Corrected, and it is the fourth copy of the same #235
oversight.

**The feature-flag section was two flags short of the truth.** It documented 5;
[feature-flags.ts](../../src/lib/server/feature-flags.ts) declares 8. `contentFlags`,
`directMessages` and `volunteering` were undocumented. Added.

**Moderation Appeals duplicated its own spec at length.** A ~30-line Progress block restated
`moderation-appeals-spec.md`'s design decisions — the "every moderation action is an upheld report"
rule, `content_flag.origin`, the second-staffer asymmetry — while every other IDEAS entry is a 2–4
line pointer. Shrunk to match, with one deliberate exception: its closing **"suggestions have no
return state"** paragraph appears in no spec and is the only written record of that gap, so it stays.

**Accurate, left alone:** Community Calendar, Member Voting / Proposals, Booking Request Pipeline,
Tech Rider Management, Event Settlement.

---

## 6. Execution order — as it ran

1. ~~**Correct the stale claims**~~ — ✅ spec, parity report, IDEAS, docs README.
2. ~~**Sweep the finished chores**~~ — ✅ two moved to Done.
3. ~~**Write the missing manual coverage**~~ — ✅ 5 articles, 2 new categories, and the icon-map fix
   that makes categories render as themselves.
4. ~~**Add the new `business-workflows.md` sections**~~ — ✅ four sections plus the staff subsection
   under §1.
5. ~~**Split `reservation-confirmation-window.md`**~~ — ✅ it is now a Phase 3 spec, with the shipped
   phases pointing at business-workflows §1 and a note on the lock's finite user table, which is the
   constraint that decides whether Phase 3 is safe to build.
6. ~~**Move the 23 and rewrite the references**~~ — ✅ in one commit, with a repo-wide link check.

### What is left

- **Phase 3 of the confirmation window** — the only half-built thing left in `docs/specs/`.
- **Keeping the split honest.** Nothing enforces it: a feature can ship and leave its spec in
  `docs/specs/`, which is exactly how the drift this audit found got started. Moving the spec is now
  the last line of the feature checklist in
  [conventions.md](../development/conventions.md#the-feature-checklist); a `docs:check` rule that
  compares spec names against shipped routes would be the mechanical version, and does not exist.
