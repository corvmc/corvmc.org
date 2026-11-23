---
paths:
  - 'scripts/seed/**'
  - 'scripts/seed-dev.ts'
---

# Seed data

Personas and their kinds: `docs/development/local-dev-quickstart.md`.

- **`user.member_number` is UNIQUE.** Before giving a persona one, check it is free
  (`grep -rn memberNumber scripts/seed/`); a collision aborts `pnpm db:seed` partway.
