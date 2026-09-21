import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A `<svelte:boundary>` catches nothing without a `failed` snippet or an
 * `onerror`: the error passes straight through and the route 500s. That is how
 * a rejected U-tec credential took down the Staff Settings page that exists to
 * fix it (#1331). The allowlist is the tree as found, not a blessing.
 */
const UNGUARDED_TODAY = [
	'src/lib/components/ui/Form/SearchSelect.svelte',
	'src/lib/components/reservations/ConflictWarnings.svelte',
	'src/lib/components/actions/CreateLoanAction.svelte',
	'src/routes/band/[slug]/+page.svelte',
	'src/routes/member/directory/instructors/+page.svelte',
	'src/routes/member/account/DirectMessagesSection.svelte',
	'src/routes/member/account/EmailSubscriptionsSection.svelte',
	'src/routes/(public)/directory/instructors/+page.svelte',
	'src/routes/staff/reservations/CreateModal.svelte',
	'src/routes/staff/instructors/+page.svelte',
	'src/routes/staff/productions/CreateEventModal.svelte',
	'src/routes/staff/events/[id]/production/+page.svelte'
];

const BOUNDARY = /<svelte:boundary\b([^>]*)>([\s\S]*?)<\/svelte:boundary>/g;

function svelteFiles(dir: string): string[] {
	return readdirSync(dir, { recursive: true, encoding: 'utf8' })
		.filter((f) => f.endsWith('.svelte'))
		.map((f) => join(dir, f));
}

describe('svelte:boundary', () => {
	it('catches something, or is on the list of surfaces that do not', () => {
		const unguarded = svelteFiles('src').filter((file) => {
			const source = readFileSync(file, 'utf8');
			return [...source.matchAll(BOUNDARY)].some(
				([, attrs, body]) => !attrs.includes('onerror') && !body.includes('#snippet failed')
			);
		});

		expect(unguarded.sort()).toEqual([...UNGUARDED_TODAY].sort());
	});
});
