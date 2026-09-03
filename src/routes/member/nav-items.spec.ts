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
 * These rows used to be nested `{#if}`s in the layout — the shape
 * `band/[slug]/nav-items.ts` records as having been silently wrong twice — and
 * then feature flags. Every member-nav flag is now retired, so what varies is
 * data (`hasLoanableEquipment`) rather than configuration. The two fixtures are
 * kept, and named for what they now mean, because the assertions below are still
 * about a fully-lit nav versus a minimal one.
 */

const ALL_ON: MemberNavInput = { hasLoanableEquipment: true };
const ALL_OFF: MemberNavInput = {};

const keysOf = (input: MemberNavInput) => memberNavItems(input).map((i) => i.key);

// The music library is flag-gated, and the flag is the launch switch for the
// whole storefront — so with it off the row must be absent even though the
// route still answers.

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

	// Volunteering was flag-gated and the flag was on in production, so retiring it
	// left the row permanently present rather than unlinking it. Both fixtures get
	// it now, which is the assertion that would catch it being made conditional
	// again by accident.
	it('always shows Volunteering, which is no longer gated', () => {
		expect(keysOf(ALL_ON)).toContain('volunteer');
		expect(keysOf(ALL_OFF)).toContain('volunteer');
	});

	/**
	 * Help had a footer row gated on a `helpArticles` flag. The flag is retired
	 * and the help centre is unlinked rather than launched, so no input produces
	 * the row — relaunching means putting it back, and this is what fails first
	 * when someone does.
	 */
	it('keeps Help out of the nav entirely while the help centre is unlinked', () => {
		expect(keysOf(ALL_ON)).not.toContain('help');
		expect(keysOf(ALL_OFF)).not.toContain('help');
	});

	it('keeps Suggestions ungated — a board with no audience has nothing to dark-launch', () => {
		expect(keysOf(ALL_OFF)).toContain('suggestions');
	});

	it('never lets a flag disturb the bottom cluster order', () => {
		// Identical for both inputs now: Help was the only footer row a flag could
		// add, and it is unlinked.
		for (const input of [ALL_OFF, ALL_ON]) {
			expect(memberNavFooter(input).map((i) => i.key)).toEqual([
				'profile',
				'account',
				'membership'
			]);
		}
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
		['/member/equipment', 'equipment'],
		['/member/equipment/loans', 'equipment-loans'],
		// A scanned unit lights the parent: it is gear, and there is no row of its
		// own for it to light.
		['/member/equipment/assets/abc', 'equipment']
	];

	it.each(cases)('lights one row for %s', (path, key) => {
		expect(activeMemberNavKey(ALL_ON, path)).toBe(key);
	});

	// Was "falls back to the panel root when a flagged row is off". No member-nav
	// row is flag-gated any more, so the surviving claim is the useful half: a
	// sub-path of a row that *is* present lights that row.
	it('lights the parent row for a sub-path', () => {
		expect(activeMemberNavKey(ALL_OFF, '/member/volunteer/start')).toBe('volunteer');
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
	 *  - `/member/equipment/assets/[id]` is reached by pointing a phone at the
	 *    sticker on a piece of gear and nothing else. It is not stranded pending
	 *    a nav row — a row would be meaningless, since there is no "the unit" to
	 *    navigate to. This line is expected to stay.
	 *
	 * `/member/equipment` and its loans page used to be here. They now get a row
	 * once `hasLoanableEquipment` is true, which is why `ALL_ON` sets it: the
	 * stranded check asks what a fully-lit nav reaches.
	 *
	 * Delete a line when its page gets a row of its own.
	 */
	const strandedOnDashboard = new Set([
		'/member/equipment/assets/[id]',
		// Reached through the My Bands and My Groups sidebar groups and their
		// "All" links, not through a nav row of their own. Two collapsible groups
		// for two indexes, which is the separation the routes draw.
		'/member/bands',
		'/member/groups',
		'/member/groups/[slug]',
		// Unlinked rather than launched: the `helpArticles` flag was off in
		// production and was retired without turning the help centre on, so the
		// footer row went with it. Relaunching restores the row and these two
		// lines come out. See docs/plans/feature-flag-retirement.md.
		'/member/help',
		'/member/help/[slug]'
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

	it('shows Equipment only when there is something to lend', () => {
		// Data, not a flag. An empty catalogue with a nav row pointing at it is a
		// promise the collective is not keeping.
		expect(keysOf({ hasLoanableEquipment: true })).toContain('equipment');
		expect(keysOf({ hasLoanableEquipment: false })).not.toContain('equipment');
		expect(keysOf({})).not.toContain('equipment');
	});

	it('hides My Loans with it — a loans page under no catalogue is a dead end', () => {
		const withGear = memberNavMain({ hasLoanableEquipment: true });
		const equipment = withGear.find((i) => i.key === 'equipment');
		expect(equipment?.children?.map((c) => c.key)).toEqual(['equipment-loans']);
		expect(keysOf({ hasLoanableEquipment: false })).not.toContain('equipment-loans');
	});

	it('keeps the stranded list honest', () => {
		const routes = new Set(memberPageRoutes());
		for (const route of strandedOnDashboard) expect(routes.has(route)).toBe(true);
	});
});

describe('purchases', () => {
	it('is always offered, whatever is switched on', () => {
		// It lists tickets as well as records, and tickets are not flagged. Gating
		// the row on the storefront would hide receipts that predate it.
		expect(keysOf(ALL_ON)).toContain('purchases');
		expect(keysOf(ALL_OFF)).toContain('purchases');
	});
});
