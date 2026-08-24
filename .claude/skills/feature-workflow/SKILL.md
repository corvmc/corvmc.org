---
name: feature-workflow
description: The nine-phase checklist for building a feature in this repo — design, schema, services, routes/UI, seed data, tests, verify, document, commit. Use when starting anything that adds database schema, adds a route, or spans several files.
---

# Building a feature here

The checklist below is the canonical version. A few notes on what the phases mean in practice:

- **Design** — a spec in `docs/specs/` is the deliverable for anything with new schema or
  cross-file reach. The existing specs are the templates; `reservation-system-spec.md` is a good
  short one, `volunteering-spec.md` a good long one.
- **Schema → Services → Routes** is a strict order. Generate the migration and review its SQL
  before writing the service, and write the service before the route, so the remote function has
  something real to delegate to.
- **Verify** means the gates in `CLAUDE.md`, matched to what you changed — `pnpm check` for
  anything typed, `pnpm test:unit -- --run` for service logic, `pnpm docs:check` if routes moved.
- **Document** is not optional: `docs/reports/parity-report.md` is how anyone knows the feature
  exists.

The canonical checklist follows, imported from `docs/development/conventions.md`:

@../../../docs/development/conventions.md
