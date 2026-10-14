import { error, redirect } from '@sveltejs/kit';
import { can } from '$lib/server/authorization';
import { mapDomainError } from '$lib/server/errors';
import { getJobById, type Engagement } from '$lib/server/contractor/contractor-job-service';
import { workOrderHref } from '$lib/utils/work-order-href';
import type { PageServerLoad } from './$types';

/**
 * An engagement is shown on its work order's page, whose engagements section
 * carries the actions this page had: sent to whichever route is canonical for
 * that work order, at the engagement's own card. Guarded as the old page was,
 * so a job id does not reveal which project its work is on.
 */
export const load: PageServerLoad = async ({ params, locals, url }) => {
	if (!locals.user) redirect(302, `/login?redirect=${encodeURIComponent(url.pathname)}`);
	if (!(await can('contractor.read'))) error(403, 'Not permitted');
	let job: Engagement;
	try {
		job = await getJobById(params.id);
	} catch (err) {
		mapDomainError(err);
	}
	const page = workOrderHref({ id: job.workOrderId, projectId: job.projectId });
	redirect(307, `${page}#engagement-${job.id}`);
};
