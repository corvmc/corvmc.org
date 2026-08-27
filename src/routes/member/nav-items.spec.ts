import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
	activeMemberNavKey,
	memberNavFooter,
	memberNavItems,
	memberNavMain,
	type MemberNavInput
} from './nav-items';

/**
 * Volunteering and Help are feature-flagged, and they used to be nested `{#if}`s
 * in the layout — the shape `band/[slug]/nav-items.ts` records as having been
 * silently wrong twice. This pins every combination.
 */

const ALL_ON: MemberNavInput = { features: { volunteering: true, helpArticles: true } };
const ALL_OFF: MemberNavInput = { features: {} };

const keysOf = (input: MemberNavInput) => memberNavItems(input).map((i) => i.key);

function concrete(route: string): string {
	return route.replace(/\[[^\]]+\]/g, 'x');
}

function memberPageRoutes(): string[] {
	const routes: string[] = [];
	const walk = (dir: string, prefix: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}/${entry.name}`);
			else if (entry.name === '+page.svelte') routes.push(prefix);
		}
	};
	walk(join(process.cwd(), 'src/routes/member'), '/member');
	return routes.sort();
}

describe('flag gating', () => {
	it('shows the unflagged rows whatever the flags say', () => {
		for (const input of [ALL_ON, ALL_OFF]) {
			expect(keysOf(input)).toEqual(
				expect.arrayContaining([
					'dashboard',
					'messages',
					'reservations',
					'events',
					'directory',
					'suggestions',
					'profile',
					'account',
					'membership'
				])
			);
		}
	});

	it('gates Volunteering on the volunteering flag', () => {
		expect(keysOf({ features: { volunteering: true } })).toContain('volunteer');
		expect(keysOf(ALL_OFF)).not.toContain('volunteer');
	});

	it('gates Help on the helpArticles flag', () => {
		expect(keysOf({ features: { helpArticles: true } })).toContain('help');
		expect(keysOf(ALL_OFF)).not.toContain('help');
	});

	it('keeps Suggestions ungated — a board with no audience has nothing to dark-launch', () => {
		expect(keysOf(ALL_OFF)).toContain('suggestions');
	});

	it('never lets a flag disturb the bottom cluster order', () => {
		expect(memberNavFooter(ALL_OFF).map((i) => i.key)).toEqual([
			'profile',
			'account',
			'membership'
		]);
		expect(memberNavFooter(ALL_ON).map((i) => i.key)).toEqual([
			'profile',
			'account',
			'help',
			'membership'
		]);
	});

	it('keeps the two zones disjoint', () => {
		const main = new Set(memberNavMain(ALL_ON).map((i) => i.key));
		for (const item of memberNavFooter(ALL_ON)) expect(main.has(item.key)).toBe(false);
	});
});

describe('activeMemberNavKey', () => {
	const cases: [string, string][] = [
		['/member', 'dashboard'],
		['/member/messages/abc', 'messages'],
		['/member/reservations/abc', 'reservations'],
		['/member/reservations/abc/pay', 'reservations'],
		['/member/events/abc', 'events'],
		['/member/events/abc/manage', 'events'],
		['/member/events/submit', 'events-submit'],
		['/member/directory/members/abc', 'directory'],
		['/member/directory/bands/some-band', 'directory'],
		['/member/suggestions/abc', 'suggestions'],
		['/member/volunteer/start', 'volunteer'],
		['/member/volunteer/feedback/abc', 'volunteer'],
		['/member/help/some-article', 'help']
	];

	it.each(cases)('lights one row for %s', (path, key) => {
		expect(activeMemberNavKey(ALL_ON, path)).toBe(key);
	});

	it('falls back to the panel root when a flagged row is off', () => {
		// The page still guards itself; the nav just has nothing to highlight.
		expect(activeMemberNavKey(ALL_OFF, '/member/volunteer/start')).toBe('dashboard');
	});

	it('lights nothing for a band, which leaves the panel', () => {
		expect(activeMemberNavKey(ALL_ON, '/band/some-band')).toBeNull();
	});

	it('resolves every row to its own key', () => {
		for (const item of memberNavItems(ALL_ON)) {
			expect(activeMemberNavKey(ALL_ON, item.href)).toBe(item.key);
		}
	});
});

describe('route coverage', () => {
	/**
	 * Pages that resolve to the panel root, so the sidebar lights Dashboard while
	 * you are somewhere else. Two different situations, both deliberate for now:
	 *
	 *  - Equipment is flag-gated (`equipment`) and has no affordance in the nav at
	 *    all — today it is reachable only from notification links. Giving it a row
	 *    is a product decision about a flagged surface, so it is recorded rather
	 *    than quietly fixed.
	 *  - `/member/bands` is reachable, just not as a row: the "All" button in the
	 *    My Bands group header goes there. Highlighting a group's action is not
	 *    something `NavGroup` models.
	 *  - `/member/equipment` and its loans page have no row on purpose: gear
	 *    lending is still arranged in person, so a browsable catalogue would
	 *    invite requests the front desk is not running through this system yet.
	 *    Cutting the `equipment` flag (#286) did not change that — the nav never
	 *    gated on the flag, it just omits the section. The row is the follow-up
	 *    for when lending stops being manual.
	 *  - `/member/equipment/assets/[id]` is reached by pointing a phone at the
	 *    sticker on a piece of gear and nothing else. It is not stranded pending
	 *    a nav row — a row would be meaningless, since there is no "the unit" to
	 *    navigate to. This line is expected to stay.
	 *
	 * Delete a line when its page gets a row of its own.
	 */
	const strandedOnDashboard = new Set([
		'/member/equipment',
		'/member/equipment/loans',
		'/member/equipment/assets/[id]',
		'/member/bands'
	]);

	it('leaves no member page unmatched', () => {
		const orphans = memberPageRoutes().filter(
			(r) => activeMemberNavKey(ALL_ON, concrete(r)) === null
		);
		expect(orphans).toEqual([]);
	});

	it('lights something other than Dashboard for every page below the root', () => {
		const stranded = memberPageRoutes()
			.filter((r) => r !== '/member')
			.filter((r) => activeMemberNavKey(ALL_ON, concrete(r)) === 'dashboard')
			.filter((r) => !strandedOnDashboard.has(r));
		expect(stranded).toEqual([]);
	});

	it('keeps the stranded list honest', () => {
		const routes = new Set(memberPageRoutes());
		for (const route of strandedOnDashboard) expect(routes.has(route)).toBe(true);
	});
});
