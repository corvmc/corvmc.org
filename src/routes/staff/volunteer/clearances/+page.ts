import { redirect } from '@sveltejs/kit';

/**
 * The clearances table folded into People. Who holds what is a fact about a
 * person, and keeping it on its own page is what made a lapsing card a tab you
 * had to remember to open (docs/reports/volunteer-workflow-findings.md#c1).
 */
export function load() {
	redirect(308, '/staff/volunteer/people?tab=cleared');
}
