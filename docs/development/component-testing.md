# Component testing (isolated, no DB / auth / server)

Components are tested **in isolation** — no live D1 database, no auth session, no
running server. Tests run headlessly in Chromium (Playwright) and are wired into
CI already; nothing new needs to be configured.

Run the fast component loop (skips the Node `server` project and Playwright e2e):

```sh
pnpm test:changed             # only what your working-tree diff affects — start here
pnpm test:components          # client + storybook projects, headless, one shot
pnpm test:server              # the Node `server` project only
pnpm test:unit                # watch mode (all vitest projects)
```

Reach for the narrowest one that covers your change. A full `server` run is ~30s
warm and ~65s cold, and almost none of that is your assertions — the 1,800 server
tests execute in about 3s, with the rest going to Vite transforming and evaluating
the app's module graph once per test file. So the cost tracks the number of _files_
pulled in, not the number of tests, and scoping the run is what actually helps.

CI runs `pnpm test`, which executes the same files via `vitest --run`.

## Which track to use

Decide by whether the component reads its data from props or from the server.

| Component shape                                                                                                                                   | Write a…                                 | Why                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Pure** — all data via props (Button, Badge, EmptyState, PageHeader, Modal, FormField, …)                                                        | `*.stories.svelte` next to the component | Doubles as a gallery **and** an automated render/interaction test (the `storybook` Vitest project runs each story's `play`). |
| **Coupled** — `await`s a remote query/command, imports `$app/*`, or takes a remote `form()` (e.g. AccountDropdown, NotificationBell, `actions/*`) | `*.svelte.spec.ts` next to the component | `vi.mock` (native to Vitest) replaces the server dependency with a fixture. The `client` Vitest project runs these.          |

> Storybook module-mocking is intentionally avoided — it needs subpath imports or
> fragile aliases. Coupled-component logic is tested in `*.svelte.spec.ts` where
> `vi.mock` just works. Stories stay for prop-driven components.

## Shared helpers

- `src/lib/test/fixtures.ts` — `fakeUser()`, `fakeBand()`: plain objects matching
  the shapes remote queries hand to components. Each takes an `overrides` partial.
- `src/lib/test/mocks.ts` — `fakeField(name)` (a `RemoteFormField` stand-in) and
  `fakeForm(names)` (a remote `form()` stand-in) for the `actions/*` components.

## Template — pure component story

See `src/lib/components/shared/EmptyState.stories.svelte`.

```svelte
<script module>
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, within } from 'storybook/test';
	import MyComponent from './MyComponent.svelte';

	const { Story } = defineMeta({
		title: 'Shared/MyComponent',
		component: MyComponent,
		tags: ['autodocs'],
		args: {
			/* defaults shared by all stories */
		}
	});
</script>

<Story name="Default" />

<Story
	name="With Action"
	args={{ actionLabel: 'Go', actionHref: '/somewhere' }}
	play={async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const link = canvas.getByRole('link', { name: 'Go' });
		await expect(link).toHaveAttribute('href', '/somewhere');
	}}
/>
```

## Template — coupled component spec

See `src/lib/components/shared/AccountDropdown.svelte.spec.ts`.

```ts
import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

// The vi.mock factory is hoisted above all imports — it must INLINE its return
// value and cannot reference the fixtures helpers.
vi.mock('$lib/remote/layout.remote', () => ({
	getMe: () =>
		Promise.resolve({ id: 'user-1', name: 'Jane Doe', email: 'jane@example.dev', image: null })
}));
vi.mock('$app/paths', () => ({ resolve: (path: string) => path }));

describe('MyComponent', () => {
	it('renders with no DB/auth/server', async () => {
		// Import the component AFTER vi.mock is registered.
		const MyComponent = (await import('./MyComponent.svelte')).default;
		render(MyComponent);
		await expect.element(page.getByText('Jane Doe')).toBeVisible();
	});
});
```

For an `actions/*` component, prefer passing `fakeForm([...])` as the prop over
mocking the whole remote module:

```ts
import { fakeForm } from '$lib/test/mocks';
render(CancelReservationAction, { reservation: { id: 'r1' }, action: fakeForm(['id']) });
```

## Coverage

Coverage is built up incrementally — see `docs/development/component-testing-checklist.md`
for the running list of which components have stories/specs.
