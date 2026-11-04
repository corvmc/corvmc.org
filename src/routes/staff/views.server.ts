import { redirect } from '@sveltejs/kit';
import { can } from '$lib/server/authorization';
import type { StaffView } from './views';

/**
 * The bare address of a tabbed row: the first tab the viewer holds. 307 because
 * the answer is per viewer. A viewer holding none goes to the first tab, whose
 * remotes refuse them.
 */
export async function redirectToFirstView(views: readonly StaffView[], url: URL): Promise<never> {
	for (const view of views) {
		if (await can(view.cap)) redirect(307, `${view.href}${url.search}`);
	}
	redirect(307, `${views[0].href}${url.search}`);
}
