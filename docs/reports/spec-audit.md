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

| Spec                                                                            | PRs              | Evidence in the tree                                                                                                                                                                  | Doc destination                                    |
| ------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| [reservation-system-spec.md](../specs/reservation-system-spec.md)               | #78              | `reservation` table, `/member/reservations/*`, `reservation-service.ts`, lock integration                                                                                             | business-workflows §1 (already linked)             |
| [recurring-reservations-spec.md](../specs/recurring-reservations-spec.md)       | #78              | `recurring_series`, `/staff/recurring`, `generate-recurring-reservations` cron                                                                                                        | business-workflows §2 (already linked)             |
| [staff-reservations-spec.md](../specs/staff-reservations-spec.md)               | #78              | `/staff/reservations`, `/staff/reservations/[id]`, resolve + create modals                                                                                                            | business-workflows §1 — needs a staff subsection   |
| [bands-spec.md](../specs/bands-spec.md)                                         | #78, #241        | `band`, `band_member`, `band_slug_history`, `/band/[slug]/*`                                                                                                                          | business-workflows §4 (already linked)             |
| [staff-bands-spec.md](../specs/staff-bands-spec.md)                             | #78              | `/staff/bands`, `/staff/bands/[id]`, tier comp/revoke                                                                                                                                 | business-workflows §4 (already linked)             |
| [tickets-spec.md](../specs/tickets-spec.md)                                     | #78              | `ticket` table, `/events/[id]/tickets`, `/staff/events/[id]/check-in`                                                                                                                 | business-workflows §5 (already linked)             |
| [directory-profiles-spec.md](../specs/directory-profiles-spec.md)               | #78              | `user_instrument`, `user_genre`, `band_genre`, `/directory/*`, `/member/profile`                                                                                                      | manual — `profile-directory` (7 articles, covered) |
| [membership-page-spec.md](../specs/membership-page-spec.md)                     | #78              | `/member/membership`, `subscription-service`, `credit_transaction`                                                                                                                    | business-workflows §3 (already linked)             |
| [member-dashboard-spec.md](../specs/member-dashboard-spec.md)                   | #78              | `/member` landing page                                                                                                                                                                | manual — `getting-started` (covered)               |
| [email-marketing-spec.md](../specs/email-marketing-spec.md)                     | #78, #185        | `audience`, `campaign`, `subscriber`, `/staff/marketing/*`, `send-campaigns` cron                                                                                                     | business-workflows §7 (already linked)             |
| [finance-spec.md](../specs/finance-spec.md)                                     | #78, #131        | `payment_cache`, `credit_transaction`, Stripe-first payment service                                                                                                                   | business-workflows §3 + architecture/overview      |
| [member-standing-spec.md](../specs/member-standing-spec.md)                     | #224             | `member_standing` table; the three per-domain tables are gone                                                                                                                         | **new** business-workflows §Moderation             |
| [member-portal-chat-spec.md](../specs/member-portal-chat-spec.md)               | #204, #234       | `inbox_participant`, `/member/messages`, `portal` channel                                                                                                                             | **new** business-workflows §Messaging              |
| [direct-messages-spec.md](../specs/direct-messages-spec.md)                     | #213, #224, #234 | `user_block`, `user.acceptsDirectMessages`, `direct-service.ts`                                                                                                                       | **new** business-workflows §Messaging              |
| [member-suggestions-spec.md](../specs/member-suggestions-spec.md)               | #212, #217, #224 | `suggestion`, `suggestion_vote`, `suggestion_edit`, `/member/suggestions`, `/staff/suggestions`                                                                                       | **new** business-workflows §Moderation             |
| [community-calendar-spec.md](../specs/community-calendar-spec.md)               | #145 → #207      | `/events` gig guide, `event.source`, `idx_event_source`                                                                                                                               | **new** business-workflows §Gig guide              |
| [community-events-spec.md](../specs/community-events-spec.md)                   | #207, #224, #241 | `source='community'`, `/member/events/submit`, cancelled-not-hidden                                                                                                                   | **new** business-workflows §Gig guide              |
| [event-lineup-spec.md](../specs/event-lineup-spec.md)                           | #197             | `event_band` table, confirm/decline slot, `/band/[slug]/events`                                                                                                                       | **new** business-workflows §Gig guide              |
| [event-moderation-spec.md](../specs/event-moderation-spec.md)                   | #146, #197, #207 | `'event'` in `flagEntityTypes` ([flag.ts:12](../../src/lib/server/db/schema/flag.ts:12)), `/staff/flags`                                                                              | **new** business-workflows §Moderation             |
| [band-domains-spec.md](../specs/band-domains-spec.md)                           | #183, #186       | `band.customDomain*` columns ([band.ts:98](../../src/lib/server/db/schema/band.ts:98)), `/band-site/[slug]`                                                                           | business-workflows §4                              |
| [band-sites-launch.md](../specs/band-sites-launch.md)                           | #152             | Shipped and then **superseded** by `band-domains-spec.md`                                                                                                                             | archive only — no fold                             |
| [staff-user-detail-context-spec.md](../specs/staff-user-detail-context-spec.md) | #164, #211, #233 | 8 tabs in [tabs.ts](../../src/routes/staff/users/[id]/tabs.ts), 9 panel components                                                                                                    | manual — `staff-guide`                             |
| [volunteering-spec.md](../specs/volunteering-spec.md)                           | #177 → #235      | **Phase 1 _and_ Phase 2 _and_ certifications.** 9 tables, `/staff/volunteer/{roles,shifts,certifications,clearances,report}`, `/member/volunteer/{start,interests,feedback}`, 3 crons | **new** business-workflows §Volunteering           |

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

## 2. The transition: where the shipped specs go

The agreed shape is **fold and archive**: behavior moves into the documentation that is meant to
carry it, and the spec file relocates to `docs/specs/shipped/` rather than being deleted, so the
design rationale — the "why we rejected the other option" that no manual article will ever hold —
survives. When that pass runs, `docs/specs/` is left holding design intent and nothing else.

**Eight already have a home.** [business-workflows.md](../development/business-workflows.md) traces
eight workflows and already links the specs for reservations, recurring, membership, finance, bands,
staff-bands, tickets and email-marketing. Those fold into the section that cites them today.

**Four domains have no section at all.** Nothing in business-workflows.md covers:

- **Gig guide & community listings** — `community-calendar`, `community-events`, `event-lineup`, `event-moderation`
- **Messaging** — `member-portal-chat`, `direct-messages`
- **Moderation** — `member-standing`, `member-suggestions`, and the flag queue
- **Volunteering** — the whole module, both phases

**The blocking gap is the user manual, not the developer docs.** `docs/manual/README.md` lists 10
help categories and `src/content/help/` has exactly those 10 directories. None of them covers
`/member/messages`, `/member/suggestions` or `/member/events/submit` — three shipped member-facing
surfaces with no user documentation whatsoever. `volunteering` has **2** articles against a module
that now ships shifts, sign-up, certifications, clearances and post-shift feedback.

So "transition these specs into the docs" is mostly a writing job — roughly a dozen help articles and
four new workflow sections — and only incidentally a file move. That is the real cost, and it is why
this pass stopped at the audit.

**Inbound references a move would break** (~40, all resolving today):

- **5 code comments** naming a spec path: [directory-service.ts:175](../../src/lib/server/directory/directory-service.ts:175), [event-service.ts:944](../../src/lib/server/event/event-service.ts:944), [standing-service.ts:172](../../src/lib/server/moderation/standing-service.ts:172), [moderation-service.ts:116](../../src/lib/server/moderation/moderation-service.ts:116), [direct-messages.remote.ts:315](../../src/lib/remote/direct-messages.remote.ts:315), plus [reserved-slugs.ts:58](../../src/lib/reserved-slugs.ts:58) and its spec — those last two point at `groups-spec.md`, which is not moving.
- **1 user-visible string** — [staff/users/+page.svelte:215](../../src/routes/staff/users/+page.svelte:215) names `staff-bands-spec.md` in rendered copy.
- **Docs** — the spec links in business-workflows.md, `docs/plans/volunteering{,-phase-2}-checklist.md`, `docs/checklists/staff-feature-enablement.md`, `docs/reports/staff-user-management-audit.md`, `docs/reports/revenue-audit.md`, `docs/manual/README.md`, `README.md`, and the pointers in `IDEAS.md` and `CHORES.md`.

---

## 3. Stale claims — corrected in this pass

Four documents asserted things the code contradicts. All four are fixed as part of this audit.

| Where                                       | Claimed                                                                      | Actually                                                                                                                                                                                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/specs/volunteering-spec.md` §intro    | Phase 2 and certifications are "**not built**"                               | Both shipped in #235. `volunteer_shift`, `volunteer_signup`, `volunteer_shift_feedback`, `volunteer_certification`, `member_certification`, `volunteer_role_certification` all exist; `docs/plans/volunteering-phase-2-checklist.md` is 41 of 42 checked |
| `docs/specs/volunteering-spec.md` §hour log | `shiftId` is "a bare text column, not a foreign key" and "always null today" | It is a real FK with `onDelete: 'set null'` ([volunteer.ts:342](../../src/lib/server/db/schema/volunteer.ts:342))                                                                                                                                        |
| `docs/reports/parity-report.md` item 8      | Volunteering Phase 2 "designed … but not built"                              | Same error. Its `Last updated` predated #235, #245 and #247                                                                                                                                                                                              |
| `docs/README.md` volunteering row           | "shifts + certifications designed, unbuilt"                                  | Same error, third copy                                                                                                                                                                                                                                   |

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

## 6. Execution order for the transition

Sequenced so no step lands on a moving target.

1. ~~**Correct the stale claims**~~ — ✅ done in this pass (spec, parity report, IDEAS, docs README).
2. ~~**Sweep the finished chores**~~ — ✅ done in this pass.
3. **Write the four missing manual categories** — messaging/DMs, suggestions, community-event
   submission, moderation & standing — and bring `volunteering` up from 2 articles to cover shifts,
   clearances and feedback. Largest step by far; `docs/manual/README.md` is the checklist.
4. **Add the four new `business-workflows.md` sections** — gig guide, messaging, moderation,
   volunteering — plus a staff subsection under §1 for `staff-reservations`.
5. **Split `reservation-confirmation-window.md`** — Phase 3 is the only part that is still a spec.
6. **Move the 23 into `docs/specs/shipped/`** and rewrite all inbound references in one pass, so no
   intermediate commit has a dangling link. `pnpm docs:check` and `pnpm lint` are the gates.

Steps 3 and 4 are the work. Step 6 is an afternoon.
