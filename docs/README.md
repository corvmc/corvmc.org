# CorvMC Documentation

This folder holds all project documentation, grouped by type. Developer docs describe how the
system is designed and built; the user manual (`manual/`) describes how to use it.

| Folder                              | What's in it                                                                  | Audience            |
| ----------------------------------- | ----------------------------------------------------------------------------- | ------------------- |
| [`decisions/`](decisions/README.md) | Dated decision records — why the app is built the way it is                   | Developers          |
| [`plans/`](#plans)                  | Sequenced implementation plans (PR-by-PR); historical once shipped            | Developers          |
| [`architecture/`](#architecture)    | System overview, operations manual, deployment runbook, infra proposals       | DevOps / Developers |
| [`development/`](#development)      | Contributor guides — quickstart, conventions, workflows, UI patterns, testing | Developers          |
| [`reports/`](#reports)              | Living status reports                                                         | Team / Stakeholders |
| [`checklists/`](#checklists)        | Cross-cutting rollouts tracked to completion                                  | Developers          |
| [`manual/`](#manual)                | End-user manual manifest & public-site articles                               | End users           |

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

**Proposals live on issues; the repo keeps living docs and decision records.** A feature's
proposal is the issue body or a comment, and is never committed. Each build PR updates the docs that
describe current behaviour, and a feature's last PR adds a record to
[`decisions/`](decisions/README.md), which indexes its own records. See
[conventions](development/conventions.md#living-docs-and-decision-records).

**New maintainer? Read in this order:**
[local-dev-quickstart](development/local-dev-quickstart.md) →
[architecture overview](architecture/overview.md) →
[business-workflows](development/business-workflows.md) →
[conventions](development/conventions.md) →
[working-with-claude](development/working-with-claude.md) →
[operations-manual](architecture/operations-manual.md) →
[deployment-checklist](architecture/deployment-checklist.md) (first deploy only).

---

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
| [domain-model.md](architecture/domain-model.md)                                       | ✅     | What the tables _mean_: three verticals over three horizontals, and the shapes that recur                                 |
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
| [writing.md](development/writing.md)                           | ✅     | Pass/fail rubric for interface titles, labels and body text                         |
| [component-testing.md](development/component-testing.md)       | ✅     | Colocated specs, fixtures, mocking the server                                       |
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
