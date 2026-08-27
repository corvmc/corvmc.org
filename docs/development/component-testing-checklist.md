# Component testing coverage checklist

Incremental coverage for isolated component tests. See
[component-testing.md](./component-testing.md) for the how. Pure components get a
`.stories.svelte`; coupled components get a `.svelte.spec.ts`.

## Harness (done)

- [x] `src/lib/test/fixtures.ts` — `fakeUser`, `fakeBand`
- [x] `src/lib/test/mocks.ts` — `fakeField`, `fakeForm`
- [x] `pnpm test:components` script
- [x] Docs: `component-testing.md` + pointer from `ui-patterns.md`
- [x] Exemplar story: `EmptyState.stories.svelte`
- [x] Exemplar spec: `AccountDropdown.svelte.spec.ts`

## Pure components — stories

- [x] EmptyState
- [x] Button
- [x] Badge
- [x] StatusBadge
- [x] Avatar
- [x] EntityAvatar
- [x] Alert
- [x] PageHeader
- [x] InfoCard
- [x] StatCard
- [x] Modal
- [x] CopyableId
- [x] VinylCard / VinylCardCta (decorative)
- [x] IdCard / IdCardCta (decorative)
- [x] EntityChip (stories + `EntityChip.svelte.spec.ts` — hover/focus/tap preview needs real
      `page.hover()`; bits-ui ignores synthetic events)
- [x] EntityIdentity (stories + `EntityIdentity.svelte.spec.ts` — pins the no-wrapper `sm` shape,
      that a bare cell draws no status, and that status rides the media once given an avatar)
- [x] EntityCard (stories)
- [x] RelatedList (stories cover the three states its `{:catch}` exists for)
- [ ] FormField (has a spec; add a story for the gallery)

See `docs/development/component-style-audit.md` for the visual audit run over these.

## Coupled components — specs

- [x] AccountDropdown
- [x] EntityViewer (covered through the identity/chip specs, which mount it as their harness)
- [x] Nav/NavGroup (collapse, persistence, and the open-on-navigate rule)
- [x] Nav/NavItem (the `active` override vs. the built-in exact match)
- [ ] NotificationBell
- [ ] TabBar
- [ ] actions/CancelReservationAction (use `fakeForm`)
- [ ] actions/AdjustCreditsAction
- [ ] actions/CreateBandAction
- [ ] remaining `actions/*` (15 more)
