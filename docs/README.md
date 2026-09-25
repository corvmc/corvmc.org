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

The backlog is **[GitHub Issues](https://github.com/corvmc/corvmc.org/issues)**, not a file in
here. `CHORES.md` and `IDEAS.md` used to sit at the repo root and were retired into the tracker in
September 2026 — by then `CHORES.md` carried an open item whose own "Done" entry sat eighty lines
below it, which is the argument for the move. Docs describe how things work; what is _owed_ is an
issue, because an issue can be searched, labelled, assigned and closed by the PR that fixes it.

| You want                 | Run                                             |
| ------------------------ | ----------------------------------------------- |
| Cleanup and known gaps   | `gh issue list --search 'type:"Tech debt"'`     |
| Unbuilt feature ideas    | `gh issue list --search 'type:Feature'`         |
| Something behaving badly | `gh issue list --search 'type:Bug'`             |
| Anything in one area     | `gh issue list --label area:events` (and so on) |

**Type is a GitHub issue type, area is a label**, and the split is deliberate: a type is
single-select, so an issue cannot be both a feature and debt, which is what `tech-debt` and
`enhancement` allowed while they were labels. An area is a label because it is what the tooling
reads — `gh issue list --label area:<vertical>` needs no project, no GraphQL and no field id, and
the SessionStart hook and `.claude/rules/` both print it. Every issue must carry one;
`.github/workflows/issue-area-guard.yml` labels `needs-area` on any that does not.

Each folder also has a short `README.md` so it lands somewhere legible when opened on github.com.
Those are orientation — what the folder is for and the rule that governs it — and carry
`<!-- docs-index: delegated -->`, which tells `pnpm docs:check` that **this file remains the one
index**. Do not start a second catalog in a folder README; a doc missing from _this_ page is still
an integrity error.

Library evaluations for unbuilt work moved to
[`reports/library-candidates.md`](reports/library-candidates.md).

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

| Doc                                                                                    | Status | Lifecycle | Notes                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------- | ------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [reservation-system-spec.md](specs/shipped/reservation-system-spec.md)                 | ✅     | archived  | Practice-room reservations, lock integration, book-then-pay                                                                                                                                                                                                      |
| [recurring-reservations-spec.md](specs/shipped/recurring-reservations-spec.md)         | ✅     | archived  | RRULE series, prototype cloning, advance windows                                                                                                                                                                                                                 |
| [staff-reservations-spec.md](specs/shipped/staff-reservations-spec.md)                 | ✅     | archived  | Staff reservation backend, resolve modal, overrides                                                                                                                                                                                                              |
| [reservation-confirmation-window.md](specs/shipped/reservation-confirmation-window.md) | ✅     | archived  | Door codes minted on confirm and provisioned across the 3-day window; the window itself is business-workflows §1                                                                                                                                                 |
| [instructors-spec.md](specs/shipped/instructors-spec.md)                               | ✅     | archived  | Teaching in the practice room: a staff-granted `instructor`, its own rate and booking horizon, a public instructor listing. CMC rents teachers the space — no enrolment, no students, no payouts. **The $5/hr rate is the member rate uncapped, not a discount** |

### Bands & groups

| Doc                                                                | Status | Lifecycle | Notes                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------ | ------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [bands-spec.md](specs/shipped/bands-spec.md)                       | ✅     | archived  | Band entity, membership, ownership, invitations — superseded in part by `groups-spec.md`                                                                                                                                                                                                                                                          |
| [staff-bands-spec.md](specs/shipped/staff-bands-spec.md)           | ✅     | archived  | Staff band management & moderation; impersonation deliberately deferred                                                                                                                                                                                                                                                                           |
| [band-domains-spec.md](specs/shipped/band-domains-spec.md)         | ✅     | archived  | `{slug}.corvmc.org` for every band; custom domains as the premium tier                                                                                                                                                                                                                                                                            |
| [band-audio-spec.md](specs/shipped/band-audio-spec.md)             | ✅     | archived  | Band releases, the private-bucket storefront, the refusable split, and CMC Radio's materialized timetable                                                                                                                                                                                                                                         |
| [band-sites-launch.md](specs/shipped/band-sites-launch.md)         | 📦     | archived  | Shipped, then superseded outright by `band-domains-spec.md`                                                                                                                                                                                                                                                                                       |
| [groups-spec.md](specs/shipped/groups-spec.md)                     | ✅     | archived  | Bands/clubs/committees: `group` + `directory_entry` + `band_site`, roster, announcements, documents. **All eleven phases shipped**, including clubs, committees, all three `joinPolicy` values and external acts                                                                                                                                  |
| [committees-and-roles-spec.md](specs/committees-and-roles-spec.md) | 📋     | spec      | The six committees and the event roles as user stories, each marked with what serves it today. A requirements map rather than one feature's design. **Re-checked 2026-09-13**: eighteen markers corrected in place, and the capability layer it calls impossible now exists — what remains is `requireCommitteeRole`, a guard over `group_member` |
| [packing-list-spec.md](specs/shipped/packing-list-spec.md)         | ✅     | archived  | What goes in the van, who is bringing it, and whether it is loaded — the tech rider asked the friendlier way round. Two owner columns that are not redundant, a diff-not-replace save, a conditional claim, and a promote that appends to a rider corner rather than rebuilding it                                                                |

### Events

| Doc                                                                        | Status | Lifecycle | Notes                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------- | ------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [tickets-spec.md](specs/shipped/tickets-spec.md)                           | ✅     | archived  | Ticketed events, Stripe, guest checkout, member discount                                                                                                                                                                                                                                                              |
| [ticket-contributions-spec.md](specs/shipped/ticket-contributions-spec.md) | ✅     | archived  | Optional contribution at ticket checkout, per-purchase member-discount waiver, per-ticket amounts                                                                                                                                                                                                                     |
| [ticket-sliding-scale-spec.md](specs/shipped/ticket-sliding-scale-spec.md) | ✅     | archived  | NOTAFLOF online: a suggested price with a per-event floor that defaults to $0, and a split bar dividing what the buyer pays between the acts and the collective. Recorded, not routed — an act is paid like a contractor, never through Connect. Supersedes the member ticket discount                                |
| [event-lineup-spec.md](specs/shipped/event-lineup-spec.md)                 | ✅     | archived  | `event_band`: who played vs. who manages; confirm/decline a credited slot                                                                                                                                                                                                                                             |
| [community-calendar-spec.md](specs/shipped/community-calendar-spec.md)     | ✅     | archived  | Phase 1 — `/events` as a unified gig guide across CMC and member bands                                                                                                                                                                                                                                                |
| [community-events-spec.md](specs/shipped/community-events-spec.md)         | ✅     | archived  | Phase 2 — member-authored `source='community'` listings, event tips, cancelled-not-hidden                                                                                                                                                                                                                             |
| [event-moderation-spec.md](specs/shipped/event-moderation-spec.md)         | ✅     | archived  | `contentFlag` coverage for the gig guide; reactive, no pre-approval queue                                                                                                                                                                                                                                             |
| [event-recaps-spec.md](specs/event-recaps-spec.md)                         | 📋     | spec      | Staff attach recap photos to a past event in the existing `gallery` slot of `media_attachment`; the public page shows them and `/events` gets a recent-recaps strip. No schema change                                                                                                                                 |
| [production-workflow-spec.md](specs/production-workflow-spec.md)           | 🔧     | split     | Run of show shipped; the deal and expenses are part-shipped; settlement reads but nothing settles; close-out unstarted (#1133). CMC-produced shows: run of show → settlement → close-out; venues, external acts. **Partly superseded** — see the status banner at its top                                             |
| [project-spec.md](specs/project-spec.md)                                   | 🔧     | split     | Phases 1–3 shipped — the table, its five `project_id` anchors, `project-service.ts`, `/staff/projects` and the suggestion loop. #822 carries the deal shape and generate-on-close. `project` as a root entity above events: committee ownership, the suggestion pipeline, derived budget burn, the general deal shape |
| [event-poster-spec.md](specs/event-poster-spec.md)                         | 📋     | spec      | A show's poster as an artifact request to an artist, delivered on `/act/{token}` and promoted to the poster slot; a template flyer rendered on workerd when nothing arrives (#608, #606)                                                                                                                              |
| [market-vendors-spec.md](specs/shipped/market-vendors-spec.md)             | ✅     | archived  | A market day CMC hosts: `market_day` + `market_vendor`, a public application form that opens a `web` inbox thread, staff accept/decline with a table label, accepted vendors on the event page. Behaviour in business-workflows §18. Fees (#1502) and day-of check-in (#1505) still open                              |
| [staff-events-split-spec.md](specs/shipped/staff-events-split-spec.md)     | ✅     | archived  | Calendar (`/staff/events`, staff view of the public gig guide) vs Productions (`/staff/productions`, the CMC work surface); why the axis is work-vs-publicity, and why the canonical URL got the less privileged view                                                                                                 |

### Members & directory

| Doc                                                                    | Status | Lifecycle | Notes                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------- | ------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [directory-profiles-spec.md](specs/shipped/directory-profiles-spec.md) | ✅     | archived  | Member/band profiles, instruments, genres, visibility                                                                                                                                                                                             |
| [membership-page-spec.md](specs/shipped/membership-page-spec.md)       | ✅     | archived  | Sustaining membership UI, credit balance, Stripe portal                                                                                                                                                                                           |
| [member-dashboard-spec.md](specs/shipped/member-dashboard-spec.md)     | ✅     | archived  | Member landing page                                                                                                                                                                                                                               |
| [member-skill-tags-spec.md](specs/shipped/member-skill-tags-spec.md)   | ✅     | archived  | A `skill` directory tag: set on the profile, filterable                                                                                                                                                                                           |
| [formal-balloting-spec.md](specs/shipped/formal-balloting-spec.md)     | ✅     | archived  | Group ballots (committee roster, recorded) and member-wide ballots (members of record, secret but auditable: participation and a per-option counter, no joinable link). Tallies hidden until close; a named certifier publishes the result (#577) |
| [classifieds-spec.md](specs/classifieds-spec.md)                       | 📋     | spec      | Members-only wanted/offered posts that expire; reported via `content_flag`, answered by DM                                                                                                                                                        |
| [local-resources-spec.md](specs/shipped/local-resources-spec.md)       | ✅     | archived  | Public staff-curated list of local music businesses, with a structured public tip form                                                                                                                                                            |

### Money & messaging

| Doc                                                                            | Status | Lifecycle | Notes                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------ | ------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [finance-spec.md](specs/shipped/finance-spec.md)                               | ✅     | archived  | Stripe-first payments, credit wallets / ledger                                                                                                                                                                                                                                                                                                                                                                            |
| [financial-record-spec.md](specs/shipped/financial-record-spec.md)             | ✅     | archived  | One append-only table recording what the collective earned, spent and was given. Stripe owns settlement; this owns accounting. Populated in production and reconciled to the cent against Stripe.                                                                                                                                                                                                                         |
| [tap-to-pay-spec.md](specs/tap-to-pay-spec.md)                                 | 🔧     | spec      | Card-present door sales on one sideloaded Android phone, being built on `feature/tap-to-pay`: Terminal as members of the `PaymentGateway` port, a guarded remote for connection tokens, a door screen for collective-sold shows, and a Capacitor shell pointed at the live site. No new table or column: a door purchase's id is its PaymentIntent id. Scopes #612's unattended kiosk out, since Tap to Pay cannot be one |
| [development-agreements-spec.md](specs/shipped/development-agreements-spec.md) | ✅     | archived  | Sponsors and grants as two staff-only modules (amended after #1479 was reversed): `sponsor`/`sponsorship` and `funder`/`grant_application`/`grant_report`, a shared ISO-day deadline helper, `sponsor.*` and `grant.*` capabilities. Placement, reminders and renewals are sub-issues (#595, #574)                                                                                                                        |
| [email-marketing-spec.md](specs/shipped/email-marketing-spec.md)               | ✅     | archived  | Audiences, campaigns, scheduled sends                                                                                                                                                                                                                                                                                                                                                                                     |
| [member-portal-chat-spec.md](specs/shipped/member-portal-chat-spec.md)         | ✅     | archived  | Member↔staff conversations as an inbox channel (`portal`); `inbox_participant`                                                                                                                                                                                                                                                                                                                                            |
| [direct-messages-spec.md](specs/shipped/direct-messages-spec.md)               | ✅     | archived  | Member↔member DMs: request/accept consent, silent drops, blocks, reporting                                                                                                                                                                                                                                                                                                                                                |
| [band-chat-spec.md](specs/shipped/band-chat-spec.md)                           | ✅     | archived  | Booking enquiries as band-owned threads (`band`); `inbox_thread.group_id`                                                                                                                                                                                                                                                                                                                                                 |

### Moderation

| Doc                                                                    | Status | Lifecycle | Notes                                                                                                                        |
| ---------------------------------------------------------------------- | ------ | --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [member-standing-spec.md](specs/shipped/member-standing-spec.md)       | ✅     | archived  | Scoped `member_standing`: what an upheld report costs, per domain. Merges the three per-domain standing tables               |
| [member-suggestions-spec.md](specs/shipped/member-suggestions-spec.md) | ✅     | archived  | Upvoted member idea board with staff responses, duplicate merging, posting-under-review                                      |
| [moderation-appeals-spec.md](specs/shipped/moderation-appeals-spec.md) | ✅     | archived  | Every moderation action is an upheld report; `moderation_appeal` hangs off the upheld flag                                   |
| [platform-ban-spec.md](specs/platform-ban-spec.md)                     | 📋     | spec      | There is no ban, only deactivation. `account_removal` records who, why and until when; suspension is a term, not a mechanism |

### Volunteering

| Doc                                                                          | Status | Lifecycle | Notes                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------- | ------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [volunteering-spec.md](specs/shipped/volunteering-spec.md)                   | ✅     | archived  | **Both phases shipped.** Roles, hour logging, approval queue and reporting; plus shifts, sign-up, certifications, clearances and post-shift feedback (#235)                                                                          |
| [volunteering-redesign-spec.md](specs/shipped/volunteering-redesign-spec.md) | ✅     | archived  | Reshaped both applications without changing the model: staff's seven nav rows became Today / Schedule / People / Setup, the member half became a next-action stack beside a claim board, and a called-off shift became a notify list |

### Inventory & assets

| Doc                                                              | Status | Lifecycle | Notes                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | ------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [inventory-spec.md](specs/inventory-spec.md)                     | 🔧     | split     | Phases 1, 2 and 4 shipped — one append-only ledger, serialized units, acquisitions with disclosure and reimbursement, `/a/[tag]` scans, restock list, spend report, manuals and damage reports. Phase 3 shipped bar Schedule M; the in-kind disclosure screen is deliberately unbuilt |
| [contractor-work-spec.md](specs/shipped/contractor-work-spec.md) | ✅     | archived  | Paid outside work — an instrument tech, an electrician: `contractor` + `contractor_job`. The other of the two places a broken thing gets fixed, and the first service expense the app records                                                                                         |
| [incident-log-spec.md](specs/shipped/incident-log-spec.md)       | ✅     | archived  | Staff incident & safety log: `incident` + append-only `incident_note`, no delete path, authors kept by name so a purge cannot anonymise a report                                                                                                                                      |

### Staff platform

| Doc                                                                                  | Status | Lifecycle | Notes                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------ | ------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [staff-user-detail-context-spec.md](specs/shipped/staff-user-detail-context-spec.md) | ✅     | archived  | `/staff/users/[id]` as an operational record: 8 tabs, 9 panels                                                                                                                                                                                                                                 |
| [reporting-spec.md](specs/shipped/reporting-spec.md)                                 | ✅     | archived  | **All four phases shipped.** The `range`/`bucket`/`csv` kit, the shared `DateRangeFilter`, the volunteer CSV, and the annual rollup at `/staff/reports` reading the financial record. Module-owned reports over a shared kit; which vendor answers which question, and why there are no charts |
| [audit-log-spec.md](specs/shipped/audit-log-spec.md)                                 | ✅     | archived  | Who did what to a member's account: append-only `audit_log`, the History card and `/staff/audit`, and a 24-month retention sweep that keeps `user.purged` rows with name and email stripped                                                                                                    |
| [staff-email-change-spec.md](specs/shipped/staff-email-change-spec.md)               | ✅     | archived  | Staff propose a member's new login email; it applies when the new mailbox confirms (#820)                                                                                                                                                                                                      |
| [admin-vs-staff-spec.md](specs/shipped/admin-vs-staff-spec.md)                       | ✅     | archived  | Roles are org positions, not tiers: guards name capabilities, the matrix maps positions to them, assignment stays in `model_has_roles`. Drops the dead spatie tables; break-glass is a documented runbook                                                                                      |
| [credit-comp-ceiling-spec.md](specs/shipped/credit-comp-ceiling-spec.md)             | ✅     | archived  | `credit.comp`: staff add up to a config ceiling of practice credit per adjustment (2 hrs), recorded as `staff_comp`; `credit.adjust` stays admin-only for everything else. The first amount-bounded capability (#579)                                                                          |
| [card-list-density-spec.md](specs/card-list-density-spec.md)                         | 📋     | spec      | A table, unless the row earns a card — four testable clauses replacing the rule at `ui-patterns.md:959`, whose three cited precedents none satisfy. The card grammar as the row's four slots folded at the container query. Decides #1032's fourteen open children                             |

The last three all came out of #164, which closed the follow-ups from a since-retired staff
user-management audit by writing a spec for each. None has been built since.

### Platform

| Doc                                          | Status | Lifecycle | Notes                                                                                               |
| -------------------------------------------- | ------ | --------- | --------------------------------------------------------------------------------------------------- |
| [media-spec.md](specs/shipped/media-spec.md) | ✅     | archived  | `media` + `media_attachment` over R2: one object shared by many entities, detach-and-sweep deletion |

Cross-cutting rather than owned by one panel. All six phases shipped; what survives in the spec is
the design rationale — why the parent link carries no foreign key, and why `file` and `media` are
two tables. How the layer _behaves_ is in the feature catalog's image-delivery and scheduled-jobs
sections. Two follow-ups it did not close are open issues: the sweep owes group
documents a pass over the private bucket, and a moderation takedown no longer kills the old poster
URL immediately.

## plans

Sequenced build plans, kept only while they track something still in motion. A finished plan's
content is either shipped (git history is the record) or was filed as an issue when retired.

| Doc                                                            | Status | Notes                                     |
| -------------------------------------------------------------- | ------ | ----------------------------------------- |
| [feature-flag-retirement.md](plans/feature-flag-retirement.md) | 🔧     | Per-flag ledger; 9 of 11 resolved, 2 held |

## architecture

| Doc                                                                                   | Status | Notes                                                                                                                     |
| ------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| [overview.md](architecture/overview.md)                                               | ✅     | **Start here** — how the system is wired (remote functions, auth, event bus, D1, cron, config)                            |
| [domain-model.md](architecture/domain-model.md)                                       | ✅     | What the tables _mean_: three verticals over two horizontals, and the shapes that recur                                   |
| [operations-manual.md](architecture/operations-manual.md)                             | ✅     | Day-to-day production ops: deploys, migrations, secrets, integrations, cron, docs upkeep, monitoring                      |
| [deployment-checklist.md](architecture/deployment-checklist.md)                       | ✅     | First-time prod deploy: D1, R2, secrets, webhooks, cron                                                                   |
| [stripe-connect-manual.md](architecture/stripe-connect-manual.md)                     | ✅     | Band payouts: what being a Stripe platform costs, the second webhook, refunds by hand, triage                             |
| [inbox-reply-setup.md](architecture/inbox-reply-setup.md)                             | ✅     | Threaded email replies to the staff inbox: MX, Postmark inbound, secrets, rollback, troubleshooting                       |
| [meta-inbox-setup.md](architecture/meta-inbox-setup.md)                               | ✅     | Instagram DMs + Messenger as inbox channels: Meta app, permissions, Page subscription, secrets, rollback, troubleshooting |
| [U-Tec Api.postman_collection.json](architecture/U-Tec%20Api.postman_collection.json) | 📦     | Vendor API collection for the door-lock integration — reference only, not maintained here                                 |

## development

| Doc                                                            | Status | Notes                                                                               |
| -------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| [local-dev-quickstart.md](development/local-dev-quickstart.md) | ✅     | Zero to running locally: env, seed data, tests, Stripe test mode                    |
| [business-workflows.md](development/business-workflows.md)     | ✅     | The fifteen core workflows, traced through code, with triage notes                  |
| [conventions.md](development/conventions.md)                   | ✅     | Feature checklist, layering rules, custom lint rules, script reference              |
| [feature-analysis.md](development/feature-analysis.md)         | ✅     | How to work out what to build — verify the premise, map handoffs, date the drift    |
| [working-with-claude.md](development/working-with-claude.md)   | ✅     | Agent-instruction surface: CLAUDE.md vs rules vs skills vs hooks, verification loop |
| [cloud-sessions.md](development/cloud-sessions.md)             | ✅     | Running Claude Code on claude.ai/code: environment allowlist, setup script, limits  |
| [door-app.md](development/door-app.md)                         | ✅     | Building and sideloading the Tap to Pay door phone's Capacitor shell (#612)         |
| [ui-patterns.md](development/ui-patterns.md)                   | ✅     | **Read before touching any page** — shared components & composition                 |
| [component-testing.md](development/component-testing.md)       | ✅     | Stories vs specs, fixtures, mocking the server                                      |
| [template-audit.md](development/template-audit.md)             | 🔧     | Class-soup census + phased migration to a component-based design system             |

## reports

| Doc                                                                              | Status | Notes                                                                                                     |
| -------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| [feature-catalog.md](reports/feature-catalog.md)                                 | ✅     | Every shipped feature — what it does and where it lives. Add a row when you ship                          |
| [standardization-audit.md](reports/standardization-audit.md)                     | ⚠️     | Ranked componentization/standardization candidates; 3 correctness issues                                  |
| [inventory-workflow-findings.md](reports/inventory-workflow-findings.md)         | 🔧     | Hands-on pass over inventory, driven as the operator, ahead of a workflow redesign                        |
| [volunteer-workflow-findings.md](reports/volunteer-workflow-findings.md)         | 📦     | The same pass over volunteering; findings complete, the restructure is separate work                      |
| [project-management-prior-art.md](reports/project-management-prior-art.md)       | ✅     | Prior art behind the `project` entity — CMMS, venue, makerspace and ERP systems surveyed                  |
| [handoff/press-kit.md](handoff/press-kit.md)                                     | ✅     | Screen handoff for the press-kit area — 12 screens at two viewports, with who/what/why each               |
| [social-prior-art.md](reports/social-prior-art.md)                               | ✅     | The social vertical by role, against the products that compete with each — and what to steal              |
| [library-candidates.md](reports/library-candidates.md)                           | ✅     | Packages surveyed for unbuilt work, and the ones rejected — split out of the retired `IDEAS.md`           |
| [ledger-reconciliation-prior-art.md](reports/ledger-reconciliation-prior-art.md) | ✅     | How four ledger systems associate a pass-through in with its payout — grouping keys, not pairwise links   |
| [card-surface-inventory.md](reports/card-surface-inventory.md)                   | ✅     | Every card-built surface — 31 card lists and 28 card stacks — audited for density; the work left as #1032 |

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

None. Nothing in `specs/` is half-built.
