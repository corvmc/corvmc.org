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

[reports/spec-audit.md](reports/spec-audit.md) classifies all 32 against the tree and records how
this split was made.

### Reservations

| Doc                                                                            | Status | Lifecycle | Notes                                                                                  |
| ------------------------------------------------------------------------------ | ------ | --------- | -------------------------------------------------------------------------------------- |
| [reservation-system-spec.md](specs/shipped/reservation-system-spec.md)         | ✅     | archived  | Practice-room reservations, lock integration, book-then-pay                            |
| [recurring-reservations-spec.md](specs/shipped/recurring-reservations-spec.md) | ✅     | archived  | RRULE series, prototype cloning, advance windows                                       |
| [staff-reservations-spec.md](specs/shipped/staff-reservations-spec.md)         | ✅     | archived  | Staff reservation backend, resolve modal, overrides                                    |
| [reservation-confirmation-window.md](specs/reservation-confirmation-window.md) | 🔧     | split     | Phases 1–2 shipped; Phase 3 (door codes minted on confirm, 3-day provisioning) unbuilt |

### Bands & groups

| Doc                                                        | Status | Lifecycle | Notes                                                                                                                                                                    |
| ---------------------------------------------------------- | ------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [bands-spec.md](specs/shipped/bands-spec.md)               | ✅     | archived  | Band entity, membership, ownership, invitations — superseded in part by `groups-spec.md`                                                                                 |
| [staff-bands-spec.md](specs/shipped/staff-bands-spec.md)   | ✅     | archived  | Staff band management & moderation; impersonation deliberately deferred                                                                                                  |
| [band-domains-spec.md](specs/shipped/band-domains-spec.md) | ✅     | archived  | `{slug}.corvmc.org` for every band; custom domains as the premium tier                                                                                                   |
| [band-sites-launch.md](specs/shipped/band-sites-launch.md) | 📦     | archived  | Shipped, then superseded outright by `band-domains-spec.md`                                                                                                              |
| [groups-spec.md](specs/groups-spec.md)                     | 🔧     | spec      | Bands/clubs/committees: `group` + `directory_entry` + `band_site`, roster, announcements, documents. #267 renamed `band` → `group` in place; the split itself is unbuilt |

### Events

| Doc                                                                    | Status | Lifecycle | Notes                                                                                                                                                  |
| ---------------------------------------------------------------------- | ------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [tickets-spec.md](specs/shipped/tickets-spec.md)                       | ✅     | archived  | Ticketed events, Stripe, guest checkout, member discount                                                                                               |
| [event-lineup-spec.md](specs/shipped/event-lineup-spec.md)             | ✅     | archived  | `event_band`: who played vs. who manages; confirm/decline a credited slot                                                                              |
| [community-calendar-spec.md](specs/shipped/community-calendar-spec.md) | ✅     | archived  | Phase 1 — `/events` as a unified gig guide across CMC and member bands                                                                                 |
| [community-events-spec.md](specs/shipped/community-events-spec.md)     | ✅     | archived  | Phase 2 — member-authored `source='community'` listings, event tips, cancelled-not-hidden                                                              |
| [event-moderation-spec.md](specs/shipped/event-moderation-spec.md)     | ✅     | archived  | `contentFlag` coverage for the gig guide; reactive, no pre-approval queue                                                                              |
| [production-workflow-spec.md](specs/production-workflow-spec.md)       | 📋     | spec      | CMC-produced shows: booking → run of show → settlement → close-out; venues, external acts. Reconciled with `groups-spec.md`                            |
| [staff-events-split-spec.md](specs/shipped/staff-events-split-spec.md) | ✅     | archived  | Productions (`/staff/events`, CMC work surface) vs Calendar (`/staff/calendar`, staff view of the public gig guide); why the axis is work-vs-publicity |

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

| Doc                                                        | Status | Lifecycle | Notes                                                                                                                                                       |
| ---------------------------------------------------------- | ------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [volunteering-spec.md](specs/shipped/volunteering-spec.md) | ✅     | archived  | **Both phases shipped.** Roles, hour logging, approval queue and reporting; plus shifts, sign-up, certifications, clearances and post-shift feedback (#235) |

### Inventory & assets

| Doc                                          | Status | Lifecycle | Notes                                                                                                                                                                                     |
| -------------------------------------------- | ------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [inventory-spec.md](specs/inventory-spec.md) | 🔧     | split     | Phases 1–2 shipped — one append-only ledger, serialized units, acquisitions, `/a/[tag]` scans, restock list and spend report. Phases 3–4 (in-kind disclosure, attached resources) unbuilt |

### Staff platform

| Doc                                                                                  | Status | Lifecycle | Notes                                                                                        |
| ------------------------------------------------------------------------------------ | ------ | --------- | -------------------------------------------------------------------------------------------- |
| [staff-user-detail-context-spec.md](specs/shipped/staff-user-detail-context-spec.md) | ✅     | archived  | `/staff/users/[id]` as an operational record: 8 tabs, 9 panels                               |
| [reporting-spec.md](specs/reporting-spec.md)                                         | 📋     | spec      | Module-owned reports over a shared kit; which vendor answers which question                  |
| [audit-log-spec.md](specs/audit-log-spec.md)                                         | 📋     | spec      | Who did what to a member's account. No audit table exists                                    |
| [staff-email-change-spec.md](specs/staff-email-change-spec.md)                       | 📋     | spec      | The most common front-desk correction, and the one the panel cannot do                       |
| [reactivation-restore-spec.md](specs/reactivation-restore-spec.md)                   | 📋     | spec      | Deactivation cancels reservations and the Stripe subscription; reactivation restores neither |
| [admin-vs-staff-spec.md](specs/admin-vs-staff-spec.md)                               | 📋     | spec      | Two elevated roles with no difference between them                                           |

The last four all came out of #164, which closed the follow-ups in
[reports/staff-user-management-audit.md](reports/staff-user-management-audit.md) by writing a spec
for each. None has been built since.

### Platform

| Doc                                  | Status | Lifecycle | Notes                                                                                               |
| ------------------------------------ | ------ | --------- | --------------------------------------------------------------------------------------------------- |
| [media-spec.md](specs/media-spec.md) | 📋     | spec      | `media` + `media_attachment` over R2: one object shared by many entities, detach-and-sweep deletion |

Cross-cutting rather than owned by one panel. Closes the media-management entry in
[`CHORES.md`](../CHORES.md), and the `band_media` object leak it found.

## plans

Sequenced build plans. Mostly historical now that the features have shipped — kept for context.

| Doc                                                                                  | Status | Notes                                               |
| ------------------------------------------------------------------------------------ | ------ | --------------------------------------------------- |
| [bands-plan.md](plans/bands-plan.md)                                                 | 📦     |                                                     |
| [tickets-plan.md](plans/tickets-plan.md)                                             | 📦     |                                                     |
| [recurring-reservations-plan.md](plans/recurring-reservations-plan.md)               | 📦     |                                                     |
| [reservation-implementation-plan.md](plans/reservation-implementation-plan.md)       | 📦     |                                                     |
| [email-marketing-plan.md](plans/email-marketing-plan.md)                             | 📦     |                                                     |
| [member-dashboard-plan.md](plans/member-dashboard-plan.md)                           | 📦     |                                                     |
| [finance-implementation-plan.md](plans/finance-implementation-plan.md)               | 📦     |                                                     |
| [events-implementation-plan.md](plans/events-implementation-plan.md)                 | 🔧     | Partial — event CRUD / R2 / ticketing config        |
| [reservation-credits-cash-checklist.md](plans/reservation-credits-cash-checklist.md) | ⚠️     | Credit/cash rework — awaiting drizzle-kit migration |
| [volunteering-checklist.md](plans/volunteering-checklist.md)                         | 📦     | Volunteering Phase 1                                |
| [volunteering-phase-2-checklist.md](plans/volunteering-phase-2-checklist.md)         | 📦     | Shifts + certifications + feedback (41/42)          |

## architecture

| Doc                                                                                   | Status | Notes                                                                                                |
| ------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| [overview.md](architecture/overview.md)                                               | ✅     | **Start here** — how the system is wired (remote functions, auth, event bus, D1, cron, config)       |
| [operations-manual.md](architecture/operations-manual.md)                             | ✅     | Day-to-day production ops: deploys, migrations, secrets, integrations, cron, docs upkeep, monitoring |
| [deployment-checklist.md](architecture/deployment-checklist.md)                       | ✅     | First-time prod deploy: D1, R2, secrets, webhooks, cron                                              |
| [inbox-reply-setup.md](architecture/inbox-reply-setup.md)                             | ✅     | Threaded email replies to the staff inbox: MX, Postmark inbound, secrets, rollback, troubleshooting  |
| [d1-migration-proposal.md](architecture/d1-migration-proposal.md)                     | ✅     | Postgres → Cloudflare D1 proposal                                                                    |
| [universal-data-layer-proposal.md](architecture/universal-data-layer-proposal.md)     | ✅     | API layer for SSR/SPA + kiosk parity (proposal)                                                      |
| [product-config-kv-migration.md](architecture/product-config-kv-migration.md)         | ⚠️     | product_config → KV — migration pending user action                                                  |
| [postmark-template-migration.md](architecture/postmark-template-migration.md)         | ✅     | Transactional email moved to Postmark-hosted templates; repo source and `pnpm email:push`            |
| [U-Tec Api.postman_collection.json](architecture/U-Tec%20Api.postman_collection.json) | 📦     | Vendor API collection for the door-lock integration — reference only, not maintained here            |

## development

| Doc                                                                          | Status | Notes                                                                               |
| ---------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- |
| [local-dev-quickstart.md](development/local-dev-quickstart.md)               | ✅     | Zero to running locally: env, seed data, tests, Stripe test mode                    |
| [business-workflows.md](development/business-workflows.md)                   | ✅     | The eight core workflows, traced through code, with triage notes                    |
| [conventions.md](development/conventions.md)                                 | ✅     | Feature checklist, layering rules, custom lint rules, script reference              |
| [working-with-claude.md](development/working-with-claude.md)                 | ✅     | Agent-instruction surface: CLAUDE.md vs rules vs skills vs hooks, verification loop |
| [ui-patterns.md](development/ui-patterns.md)                                 | ✅     | **Read before touching any page** — shared components & composition                 |
| [component-testing.md](development/component-testing.md)                     | ✅     | Stories vs specs, fixtures, mocking the server                                      |
| [component-testing-checklist.md](development/component-testing-checklist.md) | 🔧     | Incremental coverage tracker — many items open                                      |
| [component-style-audit.md](development/component-style-audit.md)             | ✅     | Visual audit; the magenta content-token theme bug it found is now fixed             |
| [template-audit.md](development/template-audit.md)                           | 🔧     | Class-soup census + phased migration to a component-based design system             |

## reports

| Doc                                                                      | Status | Notes                                                                                    |
| ------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------- |
| [feature-catalog.md](reports/feature-catalog.md)                         | ✅     | Every shipped feature — what it does and where it lives. Add a row when you ship         |
| [spec-audit.md](reports/spec-audit.md)                                   | ✅     | All 32 specs classified against the tree; which are shipped and where their content goes |
| [standardization-audit.md](reports/standardization-audit.md)             | ⚠️     | Ranked componentization/standardization candidates; 3 correctness issues                 |
| [staff-user-management-audit.md](reports/staff-user-management-audit.md) | 📦     | The audit behind #164; five follow-up specs, one of them built                           |
| [revenue-audit.md](reports/revenue-audit.md)                             | 📦     | Revenue workflow audit; its findings closed in #131                                      |
| [sentry-triage.md](reports/sentry-triage.md)                             | ✅     | Production error triage                                                                  |

## checklists

Cross-cutting rollouts tracked to completion — broader than one feature, so they live outside
`plans/`.

| Doc                                                                   | Status | Notes                                                                 |
| --------------------------------------------------------------------- | ------ | --------------------------------------------------------------------- |
| [staff-feature-enablement.md](checklists/staff-feature-enablement.md) | 📦     | Making the staff panel work independently of the feature flags        |
| [standardization-rollout.md](checklists/standardization-rollout.md)   | 🔧     | Working through `reports/standardization-audit.md`                    |
| [remote-query-fanout.md](checklists/remote-query-fanout.md)           | 🔧     | One load-bearing query per page across the 50 components that fan out |

## manual

The end-user manual. Most articles live in [`src/content/help/`](../src/content/help) and sync into
the in-app Help/KB via `pnpm help:sync`. The manifest tracks coverage across all four panels.

| Doc                                  | Status | Notes                                                      |
| ------------------------------------ | ------ | ---------------------------------------------------------- |
| [manual/README.md](manual/README.md) | 🔧     | User-manual manifest & checklist (~76 articles)            |
| [manual/public/](manual/public)      | 🔧     | Public-site how-tos (markdown only — the KB is auth-gated) |

---

### Open action items (from the docs above)

- ⚠️ **product_config → KV migration** — pending in `architecture/product-config-kv-migration.md`.
- ⚠️ **Credit/cash rework** — awaiting migration in `plans/reservation-credits-cash-checklist.md`.
- ⚠️ **Door-code timing** — Phase 3 of `specs/reservation-confirmation-window.md`, the only
  half-built thing left in `specs/`.
