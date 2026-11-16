import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

/**
 * The clearances table folded into People. Who holds what is a fact about a
 * person, and keeping it on its own page is what made a lapsing card a tab you
 * had to remember to open (docs/reports/volunteer-workflow-findings.md#c1).
 */
export const load: PageLoad = () => {
	redirect(308, '/staff/members?role=volunteer');
};
