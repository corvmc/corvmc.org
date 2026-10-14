import { redirect } from '@sveltejs/kit';
import { workOrderProjectId } from '$lib/server/volunteer/work-order-service';
import { workOrderHref } from '$lib/utils/work-order-href';
import type { PageServerLoad } from './$types';

/**
 * A project's work order lives on its task page, so links, notifications and
 * emails naming this URL are sent on there. Navigation only: this page and the
 * task page each run their own guard, and a signed-out visitor falls through
 * to this page's. Not 308, since the target moves with the work order.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	if (!locals.user) return;
	const projectId = await workOrderProjectId(params.id);
	if (projectId) redirect(307, workOrderHref({ id: params.id, projectId }));
};
