import { createContext } from 'svelte';
import type { getBandLayout } from '$lib/remote/layout.remote';

export type BandLayout = Awaited<ReturnType<typeof getBandLayout>>;

/**
 * The band panel's layout data, shared with the pages under it.
 *
 * Every page in this panel wants `layout.band` and `layout.userRole`, and each of them used to
 * get it by awaiting `getBandLayout(slug)` again alongside its own queries — nine pages, nine
 * duplicate queries, and past kit 2.64 a component holding two of them in flight renders the
 * error boundary instead of the page. The layout already has the value; this hands it down.
 *
 * A getter, not the value: `layout` is an async `$derived`, so the context has to be set during
 * the layout's synchronous init — before the `await` suspends the script body — while the value
 * itself only exists afterwards. Children read `.current` when they render, which is later still.
 *
 * `bands.remote.ts` already refreshes `getBandLayout`, so pages reading through this inherit that
 * refresh rather than needing one of their own.
 */
export const [getBandLayoutContext, setBandLayoutContext] = createContext<{
	readonly current: BandLayout;
}>();
