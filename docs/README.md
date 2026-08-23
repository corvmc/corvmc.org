# CorvMC Documentation

This folder holds all project documentation, grouped by type. Developer docs describe how the
system is designed and built; the user manual (`manual/`) describes how to use it.

| Folder                           | What's in it                                                                  | Audience            |
| -------------------------------- | ----------------------------------------------------------------------------- | ------------------- |
| [`specs/`](#specs)               | Domain & design specs — the source of truth for how a feature behaves         | Developers          |
| [`plans/`](#plans)               | Sequenced implementation plans (PR-by-PR); historical once shipped            | Developers          |
| [`architecture/`](#architecture) | System overview, operations manual, deployment runbook, infra proposals       | DevOps / Developers |
| [`development/`](#development)   | Contributor guides — quickstart, conventions, workflows, UI patterns, testing | Developers          |
| [`reports/`](#reports)           | Living status reports                                                         | Team / Stakeholders |
| [`checklists/`](#checklists)     | Cross-cutting rollouts tracked to completion                                  | Developers          |
| [`manual/`](#manual)             | End-user manual manifest & public-site articles                               | End users           |

**Status legend:** ✅ Current · 🔧 In progress · 📋 Designed, not built · 📦 Historical (shipped) · ⚠️ Action needed

**Spec lifecycle:** a spec whose feature has shipped no longer describes intent — it describes
live behavior, which is documentation's job. The **Lifecycle** column below marks those
**→ docs**: their content belongs in [business-workflows](development/business-workflows.md) and
[manual/](manual/README.md), after which the file is archived under `specs/shipped/` for its design
rationale. **spec** means it still describes something unbuilt and stays put. See
[reports/spec-audit.md](reports/spec-audit.md) for the per-spec evidence and the sequencing.

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

Behavioral source of truth for anything not yet built; a shipped-and-drifted description of live
behavior for everything else. When code and a spec disagree, treat the spec as intent and the code
as reality — reconcile deliberately, and see [reports/spec-audit.md](reports/spec-audit.md), which
classifies all 31 against the tree.

### Reservations

| Doc                                                                            | Status | Lifecycle | Notes                                                                                  |
| ------------------------------------------------------------------------------ | ------ | --------- | -------------------------------------------------------------------------------------- |
| [reservation-system-spec.md](specs/reservation-system-spec.md)                 | ✅     | → docs    | Practice-room reservations, lock integration, book-then-pay                            |
| [recurring-reservations-spec.md](specs/recurring-reservations-spec.md)         | ✅     | → docs    | RRULE series, prototype cloning, advance windows                                       |
| [staff-reservations-spec.md](specs/staff-reservations-spec.md)                 | ✅     | → docs    | Staff reservation backend, resolve modal, overrides                                    |
| [reservation-confirmation-window.md](specs/reservation-confirmation-window.md) | 🔧     | split     | Phases 1–2 shipped; Phase 3 (door codes minted on confirm, 3-day provisioning) unbuilt |

### Bands & groups

| Doc                                                | Status | Lifecycle | Notes                                                                                                                                 |
| -------------------------------------------------- | ------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [bands-spec.md](specs/bands-spec.md)               | ✅     | → docs    | Band entity, membership, ownership, invitations — superseded in part by `groups-spec.md`                                              |
| [staff-bands-spec.md](specs/staff-bands-spec.md)   | ✅     | → docs    | Staff band management & moderation; impersonation deliberately deferred                                                               |
| [band-domains-spec.md](specs/band-domains-spec.md) | ✅     | → docs    | `{slug}.corvmc.org` for every band; custom domains as the premium tier                                                                |
| [band-sites-launch.md](specs/band-sites-launch.md) | 📦     | archive   | Shipped, then superseded outright by `band-domains-spec.md`                                                                           |
| [groups-spec.md](specs/groups-spec.md)             | 📋     | spec      | Bands/clubs/committees: `group` + `directory_entry` + `band_site`, roster, announcements, documents. Only the slug reservation exists |

### Events

| Doc                                                              | Status | Lifecycle | Notes                                                                                                                       |
| ---------------------------------------------------------------- | ------ | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| [tickets-spec.md](specs/tickets-spec.md)                         | ✅     | → docs    | Ticketed events, Stripe, guest checkout, member discount                                                                    |
| [event-lineup-spec.md](specs/event-lineup-spec.md)               | ✅     | → docs    | `event_band`: who played vs. who manages; confirm/decline a credited slot                                                   |
| [community-calendar-spec.md](specs/community-calendar-spec.md)   | ✅     | → docs    | Phase 1 — `/events` as a unified gig guide across CMC and member bands                                                      |
| [community-events-spec.md](specs/community-events-spec.md)       | ✅     | → docs    | Phase 2 — member-authored `source='community'` listings, event tips, cancelled-not-hidden                                   |
| [event-moderation-spec.md](specs/event-moderation-spec.md)       | ✅     | → docs    | `contentFlag` coverage for the gig guide; reactive, no pre-approval queue                                                   |
| [production-workflow-spec.md](specs/production-workflow-spec.md) | 📋     | spec      | CMC-produced shows: booking → run of show → settlement → close-out; venues, external acts. Reconciled with `groups-spec.md` |

### Members & directory

| Doc                                                            | Status | Lifecycle | Notes                                                   |
| -------------------------------------------------------------- | ------ | --------- | ------------------------------------------------------- |
| [directory-profiles-spec.md](specs/directory-profiles-spec.md) | ✅     | → docs    | Member/band profiles, instruments, genres, visibility   |
| [membership-page-spec.md](specs/membership-page-spec.md)       | ✅     | → docs    | Sustaining membership UI, credit balance, Stripe portal |
| [member-dashboard-spec.md](specs/member-dashboard-spec.md)     | ✅     | → docs    | Member landing page                                     |

### Money & messaging

| Doc                                                            | Status | Lifecycle | Notes                                                                          |
| -------------------------------------------------------------- | ------ | --------- | ------------------------------------------------------------------------------ |
| [finance-spec.md](specs/finance-spec.md)                       | ✅     | → docs    | Stripe-first payments, credit wallets / ledger                                 |
| [email-marketing-spec.md](specs/email-marketing-spec.md)       | ✅     | → docs    | Audiences, campaigns, scheduled sends                                          |
| [member-portal-chat-spec.md](specs/member-portal-chat-spec.md) | ✅     | → docs    | Member↔staff conversations as an inbox channel (`portal`); `inbox_participant` |
| [direct-messages-spec.md](specs/direct-messages-spec.md)       | ✅     | → docs    | Member↔member DMs: request/accept consent, silent drops, blocks, reporting     |

### Moderation

| Doc                                                            | Status | Lifecycle | Notes                                                                                                          |
| -------------------------------------------------------------- | ------ | --------- | -------------------------------------------------------------------------------------------------------------- |
| [member-standing-spec.md](specs/member-standing-spec.md)       | ✅     | → docs    | Scoped `member_standing`: what an upheld report costs, per domain. Merges the three per-domain standing tables |
| [member-suggestions-spec.md](specs/member-suggestions-spec.md) | ✅     | → docs    | Upvoted member idea board with staff responses, duplicate merging, posting-under-review                        |
| [moderation-appeals-spec.md](specs/moderation-appeals-spec.md) | 📋     | spec      | Every moderation action is an upheld report; `moderation_appeal` hangs off the upheld flag                     |

### Volunteering

| Doc                                                | Status | Lifecycle | Notes                                                                                                                                                       |
| -------------------------------------------------- | ------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [volunteering-spec.md](specs/volunteering-spec.md) | ✅     | → docs    | **Both phases shipped.** Roles, hour logging, approval queue and reporting; plus shifts, sign-up, certifications, clearances and post-shift feedback (#235) |

### Staff platform

| Doc                                                                          | Status | Lifecycle | Notes                                                                                        |
| ---------------------------------------------------------------------------- | ------ | --------- | -------------------------------------------------------------------------------------------- |
| [staff-user-detail-context-spec.md](specs/staff-user-detail-context-spec.md) | ✅     | → docs    | `/staff/users/[id]` as an operational record: 8 tabs, 9 panels                               |
| [audit-log-spec.md](specs/audit-log-spec.md)                                 | 📋     | spec      | Who did what to a member's account. No audit table exists                                    |
| [staff-email-change-spec.md](specs/staff-email-change-spec.md)               | 📋     | spec      | The most common front-desk correction, and the one the panel cannot do                       |
| [reactivation-restore-spec.md](specs/reactivation-restore-spec.md)           | 📋     | spec      | Deactivation cancels reservations and the Stripe subscription; reactivation restores neither |
| [admin-vs-staff-spec.md](specs/admin-vs-staff-spec.md)                       | 📋     | spec      | Two elevated roles with no difference between them                                           |

The last four all came out of #164, which closed the follow-ups in
[reports/staff-user-management-audit.md](reports/staff-user-management-audit.md) by writing a spec
for each. None has been built since.

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

| Doc                                                                               | Status | Notes                                                                                                |
| --------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| [overview.md](architecture/overview.md)                                           | ✅     | **Start here** — how the system is wired (remote functions, auth, event bus, D1, cron, config)       |
| [operations-manual.md](architecture/operations-manual.md)                         | ✅     | Day-to-day production ops: deploys, migrations, secrets, integrations, cron, docs upkeep, monitoring |
| [deployment-checklist.md](architecture/deployment-checklist.md)                   | ✅     | First-time prod deploy: D1, R2, secrets, webhooks, cron                                              |
| [inbox-reply-setup.md](architecture/inbox-reply-setup.md)                         | ✅     | Threaded email replies to the staff inbox: MX, Postmark inbound, secrets, rollback, troubleshooting  |
| [d1-migration-proposal.md](architecture/d1-migration-proposal.md)                 | ✅     | Postgres → Cloudflare D1 proposal                                                                    |
| [universal-data-layer-proposal.md](architecture/universal-data-layer-proposal.md) | ✅     | API layer for SSR/SPA + kiosk parity (proposal)                                                      |
| [product-config-kv-migration.md](architecture/product-config-kv-migration.md)     | ⚠️     | product_config → KV — migration pending user action                                                  |

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
| [parity-report.md](reports/parity-report.md)                             | ✅     | Authoritative feature parity vs. the legacy Laravel app                                  |
| [spec-audit.md](reports/spec-audit.md)                                   | ✅     | All 31 specs classified against the tree; which are shipped and where their content goes |
| [standardization-audit.md](reports/standardization-audit.md)             | ⚠️     | Ranked componentization/standardization candidates; 3 correctness issues                 |
| [staff-user-management-audit.md](reports/staff-user-management-audit.md) | 📦     | The audit behind #164; five follow-up specs, one of them built                           |
| [revenue-audit.md](reports/revenue-audit.md)                             | 📦     | Revenue workflow audit; its findings closed in #131                                      |
| [sentry-triage.md](reports/sentry-triage.md)                             | ✅     | Production error triage                                                                  |

## checklists

Cross-cutting rollouts tracked to completion — broader than one feature, so they live outside
`plans/`.

| Doc                                                                   | Status | Notes                                                          |
| --------------------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| [staff-feature-enablement.md](checklists/staff-feature-enablement.md) | 📦     | Making the staff panel work independently of the feature flags |
| [standardization-rollout.md](checklists/standardization-rollout.md)   | 🔧     | Working through `reports/standardization-audit.md`             |

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
- ⚠️ **No manual coverage for four shipped features** — `/member/messages`, `/member/suggestions`,
  `/member/events/submit` and moderation/standing have no help category at all, and `volunteering`
  has 2 articles against a two-phase module. See `reports/spec-audit.md` §2.
- 🔧 **Spec transition** — 23 shipped specs are marked **→ docs** above and still sit in `specs/`.
  `reports/spec-audit.md` §6 sequences the move.
