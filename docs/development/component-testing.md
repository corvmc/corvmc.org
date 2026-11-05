# Component testing (isolated, no DB / auth / server)

Components are tested **in isolation** — no live D1 database, no auth session, no
running server. Tests run headlessly in Chromium (Playwright) and are wired into
CI already; nothing new needs to be configured.

Run the fast component loop (skips the Node `server` project and Playwright e2e):

```sh
pnpm test:changed             # only what your working-tree diff affects — start here
pnpm test:components          # the client project, headless, one shot
pnpm test:server              # the Node `server` project only
pnpm test:unit                # watch mode (all vitest projects)
```

Reach for the narrowest one that covers your change. A full `server` run is ~30s
warm and ~65s cold, and almost none of that is your assertions — the 1,800 server
tests execute in about 3s, with the rest going to Vite transforming and evaluating
the app's module graph once per test file. So the cost tracks the number of _files_
pulled in, not the number of tests, and scoping the run is what actually helps.

CI runs `pnpm test`, which executes the same files via `vitest --run`.

## One track: a colocated spec

Every component test is a `*.svelte.spec.ts` next to the component, run by the `client` Vitest
project in Chromium. A **pure** component (all data via props — Button, Badge, EmptyState,
PageHeader, Modal, FormField, …) is rendered with its props. A **coupled** one — it `await`s a
remote query/command, imports `$app/*`, or takes a remote `form()` (AccountDropdown,
NotificationBell, `actions/*`) — gets its server dependency replaced with `vi.mock`.

Every `ui/` primitive has a spec. A spec asserts behaviour — what renders for which props, which
callback fires, which attribute a control carries — never how it looks; a gallery of variants that
asserts nothing is not a test. Storybook was removed in #2200.

## Shared helpers

- `src/lib/test/fixtures.ts` — `fakeUser()`, `fakeBand()`: plain objects matching
  the shapes remote queries hand to components. Each takes an `overrides` partial.
- `src/lib/test/mocks.ts` — `fakeField(name)` (a `RemoteFormField` stand-in) and
  `fakeForm(names)` (a remote `form()` stand-in) for the `actions/*` components.

## Template — pure component spec

See `src/lib/components/ui/EmptyState.svelte.spec.ts`.

```ts
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import MyComponent from './MyComponent.svelte';

describe('MyComponent', () => {
	it('links the action to actionHref', async () => {
		const { container } = await render(MyComponent, {
			actionLabel: 'Go',
			actionHref: '/somewhere'
		});
		expect(container.querySelector('a')?.getAttribute('href')).toBe('/somewhere');
	});
});
```

## Template — coupled component spec

See `src/lib/components/layout/AccountDropdown.svelte.spec.ts`.

```ts
import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

// The vi.mock factory is hoisted above all imports — it must INLINE its return
// value and cannot reference the fixtures helpers.
vi.mock('#lib/remote/layout.remote.js', () => ({
	getMe: () =>
		Promise.resolve({ id: 'user-1', name: 'Jane Doe', email: 'jane@example.dev', image: null })
}));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

describe('MyComponent', () => {
	it('renders with no DB/auth/server', async () => {
		// Import the component AFTER vi.mock is registered.
		const MyComponent = (await import('./MyComponent.svelte')).default;
		await render(MyComponent);
		// `Jane Doe` comes from the mock above — the spec asserts its own fixture
		// reaches the DOM, not that any particular wording is on the page.
		await expect.element(page.getByText('Jane Doe')).toBeVisible();
	});
});
```

Asserting a fixture you supplied is fine. Asserting the component's _own_ copy is not — see
[Do not assert on copy](conventions.md#do-not-assert-on-copy). An empty state, a button label or a
tooltip sentence should be reached through a role, a `name` attribute or an exported label map, so
that rewording it is a one-file change.

`render()` returns a promise and must be awaited. Dropping the `await` does not
fail loudly — you get a `Promise` where the `RenderResult` should be, so
`container`, `rerender` and `unmount` come back `undefined` and the test dies on
a property access several lines later. `pnpm check` catches it; a bare
`await render(X)` with no destructuring typechecks either way, so keep the
`await` even where nothing reads the result.

For an `actions/*` component, prefer passing `fakeForm([...])` as the prop over
mocking the whole remote module:

```ts
import { fakeForm } from '$lib/test/mocks';
await render(CancelReservationAction, { reservation: { id: 'r1' }, action: fakeForm(['id']) });
```

## Coverage

Coverage is built up incrementally, component by component, rather than tracked as a
checklist. Issue #572 names the components still missing a spec — and undercounts:
there are 55 `*Action.svelte` files and no `*Action.spec.ts` at all.
