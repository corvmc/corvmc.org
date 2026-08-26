import { createContext } from 'svelte';
import type { getMemberLayout } from '$lib/remote/layout.remote';

export type MemberLayout = Awaited<ReturnType<typeof getMemberLayout>>;

/**
 * The member panel's layout data, shared with the pages and components under it.
 *
 * Same shape and the same reason as the band panel's `layout-context.ts`: a component that
 * re-awaits `getMemberLayout()` alongside its own query is holding two remote queries in flight,
 * which past kit 2.64 renders the error boundary instead of the page. The layout already has the
 * value.
 *
 * This one could not have been a composed query either way — `getMemberLayout` is unparameterized
 * and the inbox and direct-message mutations refresh it by name, so a page query keyed by a filter
 * set or an id would have had nothing to refresh it with.
 *
 * A getter, not the value: `layout` is an async `$derived`, so the context has to be set during
 * the layout's synchronous init — before the `await` suspends the script body — while the value
 * itself only exists afterwards.
 */
export const [getMemberLayoutContext, setMemberLayoutContext] = createContext<{
	readonly current: MemberLayout;
}>();
