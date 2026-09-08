import type { getMemberLayout } from '$lib/remote/layout.remote';

/**
 * What `AppTopbar` renders, handed down as props by each panel's layout query.
 *
 * The topbar mounts on every authenticated page, so anything it fetched for itself was a query
 * no page could get below — see `appChrome` in `$lib/remote/layout.remote`. The type derives
 * from the member layout because all three panels return the same `chrome` shape, and the import
 * is type-only: nothing here puts a query in flight. `app-chrome-queries.spec.ts` enforces that.
 */
export type AppChrome = Awaited<ReturnType<typeof getMemberLayout>>['chrome'];

export type ChromeNotification = AppChrome['notifications']['items'][number];
