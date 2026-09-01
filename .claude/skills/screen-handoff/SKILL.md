---
name: screen-handoff
description: Build a design handoff for a feature area — every screen screenshotted populated at desktop and mobile, each with who/what/where/when/how and its user stories. Use when asked for a wireframe brief, a design handoff, "screenshot every view", or a visual inventory of a module before a redesign.
---

# Screen handoffs

The deliverable is one markdown doc under `docs/reports/` plus a directory of PNGs, pairing
every screen in a feature area with the context a designer needs to redraw it.
`docs/reports/volunteer-view-handoff.md` is the worked example and
`scripts/capture-volunteer-screens.ts` the working capture script — copy that script and
swap its manifest rather than writing a new one.

## Settle four things first

Ask, don't assume — each changes the size of the job by a lot:

1. **Scope** — routes only, routes plus the load-bearing modals, or every confirm dialog. A
   module with 17 routes usually has ~30 more modal states.
2. **Seed changes** — extending `scripts/seed-dev.ts` so every screen can be populated is
   almost always right and is a real improvement, but it is a commit to shared code.
3. **Where it lands** — `docs/reports/<area>-view-handoff.md` with PNGs under
   `docs/reports/screenshots/<area>/`, plus a row in the `## reports` table in
   `docs/README.md`.
4. **Viewports** — desktop only, or desktop plus mobile. Mobile doubles the images and is
   where the real layout problems show up.

## Phase 1 — inventory

Every route, its `+page.svelte`, its guard, and the remote functions it calls. Then the
modals: they are all `bits-ui` dialogs opened by `src/lib/components/ui/Action.svelte`, so a
trigger's accessible name is its `label` prop and `getByRole('button', {name})` finds it
whether or not the button is icon-only.

Read the feature's row in `docs/development/business-workflows.md` and its spec in
`docs/specs/shipped/` — they are current, and any older friction report probably is not. Mark
each finding you cite as fixed or open rather than repeating it; several will have landed.

## Phase 2 — find the states the seed cannot reach

Do this **before** shooting anything. Look for:

- **Gated funnels.** A member surface gated on an onboarding stage needs one credentialed
  account per stage, because the stages are mutually exclusive per user. The dev seed gives
  exactly one account a password by default, and that account is an admin.
- **Structurally empty surfaces** — a card whose query can never match on any seed. The
  volunteer lapsing-clearance card needed a grant with an expiry, for a certification some
  role required, held by somebody rostered on a shift for it; the only requirement in the
  catalog never expired, so the card could not have a row.
- **Terminal states nothing seeds** — cancelled, revoked, no-show, returned.
- **Nullable foreign keys that are always null**, so the relationship never renders.
- **Lists that fill to capacity**, leaving nothing actionable on the member's side.

New personas go in their own `seedXPersonas()` with **no randomness** — literal ids, statuses
and date offsets — and must stay **out of `allUsers`**: `seedVolunteerProfiles` slices that
array and `seedUserRoles` indexes into it, so appending silently reassigns both. Print the
logins and any deep links at the end of the seed. Then update the "exactly one account with a
password" claim in `docs/development/local-dev-quickstart.md` and `README.md`.

## Phase 3 — capture

Run the dev server through `preview_start`, never Bash. From a worktree see
`.claude/skills/worktree-dev/SKILL.md`: the port comes from `pnpm worktree:ports`, `ORIGIN`
in `.env` must match it, and `.claude/launch.json` names the main checkout's port — if you
edit it to point at the worktree's, revert it before committing.

Four traps, all of which produce plausible-looking wrong output:

- **`fullPage: true` returns exactly one viewport.** The document does not scroll in this app
  — the frame is `h-dvh` and `<main>` is the scroll container — so everything below the fold
  is missing. Grow the window to `main.scrollHeight + (innerHeight - main.clientHeight)`
  before the shot. Measure a **modal** instead of the page behind it: it is portaled and
  fixed, so it centres itself in whatever height the window has.
- **`page.goto` resolves before an awaited remote query commits.** Give every screen a
  data-bearing `ready` selector _and_ a minimum of rendered `<main>` text, and fail the run
  rather than saving a header over an empty page. Do not use `networkidle`.
- **Sparse pages fail that gate honestly.** A shift detail page is 266 characters and a
  two-row catalog is 218. Dump `main.innerText.length` for every route once and set the
  thresholds from the measurements.
- **`/sign-in` is rate limited to 3 per 10s**, and with no resolvable client IP everyone
  shares one bucket. Do not run two capture sessions at the same time. `/login` is
  deliberately client-mounted, so wait for the submit button before filling the form.

Keep the `ONLY=<ids>` env filter — reshooting one screen without paying for the other sixty
is what makes iterating on the manifest affordable.

## Phase 4 — the doc

Front matter: what the feature is, the vocabulary a wireframe must use (call out any label
that differs from the stored value — `rejected` renders as "Returned"), the demo logins and
what each reaches, and a route map with guards.

Then one section per screen, in the order a user meets them:

1. Both screenshots.
2. Route, file, guard, remote functions.
3. **One paragraph — who / what / where / when / how.** Who is looking and in what role, what
   it is for, where it sits in the nav, when in the cycle it gets opened, how they act on it.
4. **User stories**, 2–5, drawn from the real workflow rather than invented.
5. **What the seed is showing** — the specific rows, so a designer knows which states are
   represented and which are absent.
6. **Known friction**, cited to the findings report by id and marked fixed or open.

Close with the open questions a wireframe pass has to decide, and a "regenerating this"
section naming the two commands.

## Finishing

`pnpm lint`, `pnpm check`, `pnpm docs:check`, and `pnpm test:unit -- --run` if the seed
changed. Verify every image link resolves and that no PNG is under ~10 KB — a blank page
still writes a valid file. Add the `docs/README.md` row. If the user wants the pack outside
the repo, zip the doc with its `screenshots/` subtree so the relative links keep working, and
send it with `SendUserFile`.
