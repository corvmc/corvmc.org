# CorvMC Documentation

This folder holds all project documentation, grouped by type. Developer docs describe how the
system is designed and built; the user manual (`manual/`) describes how to use it.

| Folder                           | What's in it                                                                  | Audience            |
| -------------------------------- | ----------------------------------------------------------------------------- | ------------------- |
| [`specs/`](#specs)               | Design intent for features that are not built yet                             | Developers          |
| [`specs/shipped/`](#specs)       | Archived specs — design rationale for features that have shipped              | Developers          |
| [`plans/`](#plans)               | Sequenced implementation plans (PR-by-PR); historical once shipped            | Developers          |
| [`architecture/`](#architecture) | System overview, operations manual, deployment runbook, infra proposals       | DevOps / Developers |
| [`development/`](#development)   | Contributor guides — quickstart, conventions, workflows, UI patterns, testing | Developers          |
| [`reports/`](#reports)           | Living status reports                                                         | Team / Stakeholders |
| [`checklists/`](#checklists)     | Cross-cutting rollouts tracked to completion                                  | Developers          |
| [`manual/`](#manual)             | End-user manual manifest & public-site articles                               | End users           |

Two working files live at the repo root rather than in here, because they are edited constantly
and are as much backlog as documentation. Specs and conventions link to both, so they are listed
for findability, not because they belong to a folder above:

| File                        | What's in it                                                                      |
| --------------------------- | --------------------------------------------------------------------------------- |
| [`CHORES.md`](../CHORES.md) | Running list of known gaps and cleanup owed — the source for "recorded in CHORES" |
| [`IDEAS.md`](../IDEAS.md)   | Unbuilt feature ideas and the library table; where a spec starts life             |

**Status legend:** ✅ Current · 🔧 In progress · 📋 Designed, not built · 📦 Historical (shipped) · ⚠️ Action needed

**Spec lifecycle:** a spec whose feature has shipped no longer describes intent — it describes live
behavior, which is documentation's job. The **Lifecycle** column below reads **archived** for those:
their behavior is written up in [business-workflows](development/business-workflows.md) and
[manual/](manual/README.md), and the file itself sits in `specs/shipped/` for its design rationale.
**spec** means it still describes something unbuilt and stays in `specs/`. When you ship a feature,
moving its spec is the last step of the checklist, not an afterthought.

**New maintainer? Read in this order:**
[local-dev-quickstart](development/local-dev-quickstart.md) →
[architecture overview](architecture/overview.md) →
[business-workflows](development/business-workflows.md) →
[conventions](development/conventions.md) →
[working-with-claude](development/working-with-claude.md) →
[operations-manual](architecture/operations-manual.md) →
[deployment-checklist](architecture/deployment-checklist.md) (first deploy only).

---

## specs

`specs/` holds design intent for things that are **not built**. When code and a spec there disagree,
treat the spec as intent and the code as reality — reconcile deliberately.

`specs/shipped/` is the archive. Those features are live, so how they _behave_ is documented in
[development/business-workflows.md](development/business-workflows.md) and
[manual/](manual/README.md); what survives in the spec is the design rationale — the options weighed
and rejected — which no manual article carries. Read a shipped spec to find out **why** something is
the way it is, and the workflow guide to find out **what** it does today.

### Reservations

| Doc                                                                            | Status | Lifecycle | Notes                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------ | ------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [reservation-system-spec.md](specs/shipped/reservation-system-spec.md)         | ✅     | archived  | Practice-room reservations, lock integration, book-then-pay                                                                                                                                                                                                      |
| [recurring-reservations-spec.md](specs/shipped/recurring-reservations-spec.md) | ✅     | archived  | RRULE series, prototype cloning, advance windows                                                                                                                                                                                                                 |
| [staff-reservations-spec.md](specs/shipped/staff-reservations-spec.md)         | ✅     | archived  | Staff reservation backend, resolve modal, overrides                                                                                                                                                                                                              |
| [reservation-confirmation-window.md](specs/reservation-confirmation-window.md) | 🔧     | split     | Phases 1–2 shipped; Phase 3 (door codes minted on confirm, 3-day provisioning) unbuilt                                                                                                                                                                           |
| [instructors-spec.md](specs/shipped/instructors-spec.md)                       | ✅     | archived  | Teaching in the practice room: a staff-granted `instructor`, its own rate and booking horizon, a public instructor listing. CMC rents teachers the space — no enrolment, no students, no payouts. **The $5/hr rate is the member rate uncapped, not a discount** |

### Bands & groups

| Doc                                                                | Status | Lifecycle | Notes                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------ | ------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [bands-spec.md](specs/shipped/bands-spec.md)                       | ✅     | archived  | Band entity, membership, ownership, invitations — superseded in part by `groups-spec.md`                                                                                                                                                             |
| [staff-bands-spec.md](specs/shipped/staff-bands-spec.md)           | ✅     | archived  | Staff band management & moderation; impersonation deliberately deferred                                                                                                                                                                              |
| [band-domains-spec.md](specs/shipped/band-domains-spec.md)         | ✅     | archived  | `{slug}.corvmc.org` for every band; custom domains as the premium tier                                                                                                                                                                               |
| [band-audio-spec.md](specs/shipped/band-audio-spec.md)             | ✅     | archived  | Band releases, the private-bucket storefront, the refusable split, and CMC Radio's materialized timetable                                                                                                                                            |
| [band-sites-launch.md](specs/shipped/band-sites-launch.md)         | 📦     | archived  | Shipped, then superseded outright by `band-domains-spec.md`                                                                                                                                                                                          |
| [groups-spec.md](specs/groups-spec.md)                             | 🔧     | spec      | Bands/clubs/committees: `group` + `directory_entry` + `band_site`, roster, announcements, documents. **Phases 0–4 shipped** — the table split, the listing table and `requireGroupRole`. Clubs and committees themselves start at phase 5            |
| [committees-and-roles-spec.md](specs/committees-and-roles-spec.md) | 📋     | spec      | The six committees and the event roles as user stories, each marked with what serves it today. A requirements map rather than one feature's design; names committee-scoped authority as the prerequisite `admin-vs-staff-spec.md` does not yet cover |

### Events

| Doc                                                                        | Status | Lifecycle | Notes                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------- | ------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [tickets-spec.md](specs/shipped/tickets-spec.md)                           | ✅     | archived  | Ticketed events, Stripe, guest checkout, member discount                                                                                                                                                                                                                               |
| [ticket-contributions-spec.md](specs/shipped/ticket-contributions-spec.md) | ✅     | archived  | Optional contribution at ticket checkout, per-purchase member-discount waiver, per-ticket amounts                                                                                                                                                                                      |
| [ticket-sliding-scale-spec.md](specs/ticket-sliding-scale-spec.md)         | 🔧     | spec      | NOTAFLOF online: a suggested price with a per-event floor that defaults to $0, and a split bar dividing what the buyer pays between the acts and the collective. Recorded, not routed — an act is paid like a contractor, never through Connect. Supersedes the member ticket discount |
| [event-lineup-spec.md](specs/shipped/event-lineup-spec.md)                 | ✅     | archived  | `event_band`: who played vs. who manages; confirm/decline a credited slot                                                                                                                                                                                                              |
| [community-calendar-spec.md](specs/shipped/community-calendar-spec.md)     | ✅     | archived  | Phase 1 — `/events` as a unified gig guide across CMC and member bands                                                                                                                                                                                                                 |
| [community-events-spec.md](specs/shipped/community-events-spec.md)         | ✅     | archived  | Phase 2 — member-authored `source='community'` listings, event tips, cancelled-not-hidden                                                                                                                                                                                              |
| [event-moderation-spec.md](specs/shipped/event-moderation-spec.md)         | ✅     | archived  | `contentFlag` coverage for the gig guide; reactive, no pre-approval queue                                                                                                                                                                                                              |
| [production-workflow-spec.md](specs/production-workflow-spec.md)           | 📋     | spec      | CMC-produced shows: run of show → settlement → close-out; venues, external acts. **Partly superseded** — see the status banner at its top                                                                                                                                              |
| [project-spec.md](specs/project-spec.md)                                   | 📋     | spec      | `project` as a root entity above events: committee ownership, the suggestion pipeline, derived budget burn, the general deal shape                                                                                                                                                     |
| [staff-events-split-spec.md](specs/shipped/staff-events-split-spec.md)     | ✅     | archived  | Productions (`/staff/events`, CMC work surface) vs Calendar (`/staff/calendar`, staff view of the public gig guide); why the axis is work-vs-publicity                                                                                                                                 |

### Members & directory

| Doc                                                                    | Status | Lifecycle | Notes                                                   |
| ---------------------------------------------------------------------- | ------ | --------- | ------------------------------------------------------- |
| [directory-profiles-spec.md](specs/shipped/directory-profiles-spec.md) | ✅     | archived  | Member/band profiles, instruments, genres, visibility   |
| [membership-page-spec.md](specs/shipped/membership-page-spec.md)       | ✅     | archived  | Sustaining membership UI, credit balance, Stripe portal |
| [member-dashboard-spec.md](specs/shipped/member-dashboard-spec.md)     | ✅     | archived  | Member landing page                                     |

### Money & messaging

| Doc                                                                    | Status | Lifecycle | Notes                                                                          |
| ---------------------------------------------------------------------- | ------ | --------- | ------------------------------------------------------------------------------ |
| [finance-spec.md](specs/shipped/finance-spec.md)                       | ✅     | archived  | Stripe-first payments, credit wallets / ledger                                 |
| [email-marketing-spec.md](specs/shipped/email-marketing-spec.md)       | ✅     | archived  | Audiences, campaigns, scheduled sends                                          |
| [member-portal-chat-spec.md](specs/shipped/member-portal-chat-spec.md) | ✅     | archived  | Member↔staff conversations as an inbox channel (`portal`); `inbox_participant` |
| [direct-messages-spec.md](specs/shipped/direct-messages-spec.md)       | ✅     | archived  | Member↔member DMs: request/accept consent, silent drops, blocks, reporting     |

### Moderation

| Doc                                                                    | Status | Lifecycle | Notes                                                                                                          |
| ---------------------------------------------------------------------- | ------ | --------- | -------------------------------------------------------------------------------------------------------------- |
| [member-standing-spec.md](specs/shipped/member-standing-spec.md)       | ✅     | archived  | Scoped `member_standing`: what an upheld report costs, per domain. Merges the three per-domain standing tables |
| [member-suggestions-spec.md](specs/shipped/member-suggestions-spec.md) | ✅     | archived  | Upvoted member idea board with staff responses, duplicate merging, posting-under-review                        |
| [moderation-appeals-spec.md](specs/moderation-appeals-spec.md)         | 📋     | spec      | Every moderation action is an upheld report; `moderation_appeal` hangs off the upheld flag                     |

### Volunteering

| Doc                                                                          | Status | Lifecycle | Notes                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------- | ------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [volunteering-spec.md](specs/shipped/volunteering-spec.md)                   | ✅     | archived  | **Both phases shipped.** Roles, hour logging, approval queue and reporting; plus shifts, sign-up, certifications, clearances and post-shift feedback (#235)                                                                          |
| [volunteering-redesign-spec.md](specs/shipped/volunteering-redesign-spec.md) | ✅     | archived  | Reshaped both applications without changing the model: staff's seven nav rows became Today / Schedule / People / Setup, the member half became a next-action stack beside a claim board, and a called-off shift became a notify list |

### Inventory & assets

| Doc                                                      | Status | Lifecycle | Notes                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------- | ------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [inventory-spec.md](specs/inventory-spec.md)             | 🔧     | split     | Phases 1, 2 and 4 shipped — one append-only ledger, serialized units, acquisitions with disclosure and reimbursement, `/a/[tag]` scans, restock list, spend report, manuals and damage reports. Phase 3 shipped bar Schedule M; the in-kind disclosure screen is deliberately unbuilt |
| [contractor-work-spec.md](specs/contractor-work-spec.md) | 🔧     | spec      | Paid outside work — an instrument tech, an electrician: `contractor` + `contractor_job`. The other of the two places a broken thing gets fixed, and the first service expense the app records                                                                                         |

### Staff platform

| Doc                                                                                  | Status | Lifecycle | Notes                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------ | ------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [staff-user-detail-context-spec.md](specs/shipped/staff-user-detail-context-spec.md) | ✅     | archived  | `/staff/users/[id]` as an operational record: 8 tabs, 9 panels                                                                                                                                            |
| [reporting-spec.md](specs/reporting-spec.md)                                         | 📋     | spec      | Module-owned reports over a shared kit; which vendor answers which question                                                                                                                               |
| [audit-log-spec.md](specs/audit-log-spec.md)                                         | 📋     | spec      | Who did what to a member's account. No audit table exists                                                                                                                                                 |
| [staff-email-change-spec.md](specs/staff-email-change-spec.md)                       | 📋     | spec      | The most common front-desk correction, and the one the panel cannot do                                                                                                                                    |
| [admin-vs-staff-spec.md](specs/admin-vs-staff-spec.md)                               | 📋     | spec      | Roles are org positions, not tiers: guards name capabilities, the matrix maps positions to them, assignment stays in `model_has_roles`. Drops the dead spatie tables; break-glass is a documented runbook |

The last three all came out of #164, which closed the follow-ups from a since-retired staff
user-management audit by writing a spec for each. None has been built since.

### Platform

| Doc                                          | Status | Lifecycle | Notes                                                                                               |
| -------------------------------------------- | ------ | --------- | --------------------------------------------------------------------------------------------------- |
| [media-spec.md](specs/shipped/media-spec.md) | ✅     | archived  | `media` + `media_attachment` over R2: one object shared by many entities, detach-and-sweep deletion |

Cross-cutting rather than owned by one panel. All six phases shipped; what survives in the spec is
the design rationale — why the parent link carries no foreign key, and why `file` and `media` are
two tables. How the layer _behaves_ is in the feature catalog's image-delivery and scheduled-jobs
sections. Two follow-ups it did not close are in [`CHORES.md`](../CHORES.md): the sweep owes group
documents a pass over the private bucket, and a moderation takedown no longer kills the old poster
URL immediately.

## plans

Sequenced build plans, kept only while they track something still in motion. A finished plan's
content is either shipped (git history is the record) or was folded into `CHORES.md` when retired.

| Doc                                                            | Status | Notes                                     |
| -------------------------------------------------------------- | ------ | ----------------------------------------- |
| [feature-flag-retirement.md](plans/feature-flag-retirement.md) | 🔧     | Per-flag ledger; 9 of 11 resolved, 2 held |

## architecture

| Doc                                                                                   | Status | Notes                                                                                                |
| ------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| [overview.md](architecture/overview.md)                                               | ✅     | **Start here** — how the system is wired (remote functions, auth, event bus, D1, cron, config)       |
| [domain-model.md](architecture/domain-model.md)                                       | ✅     | What the tables _mean_: three verticals over two horizontals, and the shapes that recur              |
| [operations-manual.md](architecture/operations-manual.md)                             | ✅     | Day-to-day production ops: deploys, migrations, secrets, integrations, cron, docs upkeep, monitoring |
| [deployment-checklist.md](architecture/deployment-checklist.md)                       | ✅     | First-time prod deploy: D1, R2, secrets, webhooks, cron                                              |
| [stripe-connect-manual.md](architecture/stripe-connect-manual.md)                     | ✅     | Band payouts: what being a Stripe platform costs, the second webhook, refunds by hand, triage        |
| [inbox-reply-setup.md](architecture/inbox-reply-setup.md)                             | ✅     | Threaded email replies to the staff inbox: MX, Postmark inbound, secrets, rollback, troubleshooting  |
| [U-Tec Api.postman_collection.json](architecture/U-Tec%20Api.postman_collection.json) | 📦     | Vendor API collection for the door-lock integration — reference only, not maintained here            |

## development

| Doc                                                            | Status | Notes                                                                               |
| -------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| [local-dev-quickstart.md](development/local-dev-quickstart.md) | ✅     | Zero to running locally: env, seed data, tests, Stripe test mode                    |
| [business-workflows.md](development/business-workflows.md)     | ✅     | The eight core workflows, traced through code, with triage notes                    |
| [conventions.md](development/conventions.md)                   | ✅     | Feature checklist, layering rules, custom lint rules, script reference              |
| [working-with-claude.md](development/working-with-claude.md)   | ✅     | Agent-instruction surface: CLAUDE.md vs rules vs skills vs hooks, verification loop |
| [ui-patterns.md](development/ui-patterns.md)                   | ✅     | **Read before touching any page** — shared components & composition                 |
| [component-testing.md](development/component-testing.md)       | ✅     | Stories vs specs, fixtures, mocking the server                                      |
| [template-audit.md](development/template-audit.md)             | 🔧     | Class-soup census + phased migration to a component-based design system             |

## reports

| Doc                                                                        | Status | Notes                                                                                        |
| -------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| [feature-catalog.md](reports/feature-catalog.md)                           | ✅     | Every shipped feature — what it does and where it lives. Add a row when you ship             |
| [standardization-audit.md](reports/standardization-audit.md)               | ⚠️     | Ranked componentization/standardization candidates; 3 correctness issues                     |
| [inventory-workflow-findings.md](reports/inventory-workflow-findings.md)   | 🔧     | Hands-on pass over inventory, driven as the operator, ahead of a workflow redesign           |
| [volunteer-workflow-findings.md](reports/volunteer-workflow-findings.md)   | 📦     | The same pass over volunteering; findings complete, the restructure is separate work         |
| [project-management-prior-art.md](reports/project-management-prior-art.md) | ✅     | Prior art behind the `project` entity — CMMS, venue, makerspace and ERP systems surveyed     |
| [handoff/press-kit.md](handoff/press-kit.md)                               | ✅     | Screen handoff for the press-kit area — 12 screens at two viewports, with who/what/why each  |
| [social-prior-art.md](reports/social-prior-art.md)                         | ✅     | The social vertical by role, against the products that compete with each — and what to steal |

## checklists

Cross-cutting rollouts tracked to completion — broader than one feature, so they live outside
`plans/`.

| Doc                                                                 | Status | Notes                                              |
| ------------------------------------------------------------------- | ------ | -------------------------------------------------- |
| [standardization-rollout.md](checklists/standardization-rollout.md) | 🔧     | Working through `reports/standardization-audit.md` |

## manual

The end-user manual. Most articles live in [`src/content/help/`](../src/content/help) and sync into
the in-app Help/KB via `pnpm help:sync`. The manifest tracks coverage across all four panels.

| Doc                                  | Status | Notes                                                      |
| ------------------------------------ | ------ | ---------------------------------------------------------- |
| [manual/README.md](manual/README.md) | 🔧     | User-manual manifest & checklist (~82 articles)            |
| [manual/public/](manual/public)      | 🔧     | Public-site how-tos (markdown only — the KB is auth-gated) |

---

### Open action items (from the docs above)

- ⚠️ **Door-code timing** — Phase 3 of `specs/reservation-confirmation-window.md`, the only
  half-built thing left in `specs/`.
