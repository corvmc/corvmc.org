import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
	activeMemberNavKey,
	memberNavChrome,
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

/** Every destination, sidebar and chrome alike. */
const keysOf = (input: MemberNavInput) => memberNavItems(input).map((i) => i.key);

/** Only what the sidebar draws — the assertion that a row did not creep back. */
const sidebarKeysOf = (input: MemberNavInput) => [
	...memberNavMain(input).map((i) => i.key),
	...memberNavFooter(input).map((i) => i.key)
];

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
	 * The help centre spent a release reachable only by typing the URL: the
	 * `helpArticles` flag was retired without the row going back, so 75 articles
	 * had no way in. Nothing gates it now, which is what these two lines pin.
	 */
	it('always shows Help — the articles ship with the repo, so there is nothing to gate on', () => {
		expect(keysOf(ALL_ON)).toContain('help');
		expect(keysOf(ALL_OFF)).toContain('help');
	});

	it('keeps Suggestions ungated — a board with no audience has nothing to dark-launch', () => {
		expect(keysOf(ALL_OFF)).toContain('suggestions');
	});

	// Both are meta — feedback about the collective, and how to use the site —
	// which is why they share the foot of the sidebar rather than sitting among
	// the things you do in the space.
	it('keeps Suggestions and Help together at the foot', () => {
		expect(memberNavFooter(ALL_ON).map((i) => i.key)).toEqual(['suggestions', 'help']);
	});

	it('never lets a flag disturb the bottom cluster order', () => {
		// Identical for both inputs: no footer row is conditional on anything.
		for (const input of [ALL_OFF, ALL_ON]) {
			expect(memberNavFooter(input).map((i) => i.key)).toEqual(['suggestions', 'help']);
		}
	});

	it('keeps the three zones disjoint', () => {
		const seen = new Set<string>();
		for (const item of memberNavItems(ALL_ON)) {
			expect(seen.has(item.key), `${item.key} is in two zones`).toBe(false);
			seen.add(item.key);
		}
	});
});

/**
 * The move in #1244. Five destinations left the sidebar for the app chrome,
 * which mounts on every authenticated page; they stay in `memberNavItems` so
 * every `/member` page still resolves to a key. The two assertions that matter
 * are that the sidebar no longer draws them and that they still resolve.
 */
describe('the chrome zone', () => {
	it('draws none of them in the sidebar', () => {
		for (const input of [ALL_OFF, ALL_ON]) {
			const sidebar = sidebarKeysOf(input);
			for (const key of ['messages', 'profile', 'account', 'purchases', 'membership']) {
				expect(sidebar, `${key} is back in the sidebar`).not.toContain(key);
			}
		}
	});

	it('is exactly Messages plus the account menu', () => {
		expect(memberNavChrome().map((i) => i.key)).toEqual([
			'messages',
			'profile',
			'account',
			'purchases',
			'membership'
		]);
	});

	it('still lights a key for every page behind it', () => {
		expect(activeMemberNavKey(ALL_ON, '/member/messages/abc')).toBe('messages');
		expect(activeMemberNavKey(ALL_ON, '/member/purchases')).toBe('purchases');
		expect(activeMemberNavKey(ALL_ON, '/member/membership')).toBe('membership');
		expect(activeMemberNavKey(ALL_ON, '/member/account')).toBe('account');
		expect(activeMemberNavKey(ALL_ON, '/member/profile')).toBe('profile');
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
	 * Pages with no nav row of their own, which therefore light nothing.
	 *
	 * Before #1237 they lit Dashboard, because `/member` is a prefix of every
	 * route in the panel. `exact` on the panel root is what stopped that, and
	 * what turned "lights the wrong row" into "lights none" — which is correct
	 * for a page reached through a group rather than a row.
	 *
	 * Delete a line when its page gets a row.
	 */
	const reachedWithoutARow = new Set([
		// Pointed at by a sticker on a piece of gear and nothing else. A row would
		// be meaningless: there is no "the unit" to navigate to.
		'/member/equipment/assets/[id]',
		// Reached through the My Acts and My Groups sidebar groups and their "All"
		// links rather than a row of their own. Two collapsible groups for two
		// indexes, which is the separation the routes draw.
		'/member/bands',
		'/member/groups',
		'/member/groups/[slug]',
		// Reached from the club page's own Edit button. A leader edits the program
		// they are already looking at; a nav row to it would point at no group.
		'/member/groups/[slug]/edit'
	]);

	it('lights a row for every page that has one', () => {
		const orphans = memberPageRoutes()
			.filter((r) => r !== '/member')
			.filter((r) => !reachedWithoutARow.has(r))
			.filter((r) => activeMemberNavKey(ALL_ON, concrete(r)) === null);

		expect(orphans, 'these pages light no row at all').toEqual([]);
	});

	/**
	 * Dashboard's href is `/member`, a prefix of every route in the panel, so
	 * before `exact` it matched everything and only lost to a longer row. The
	 * pages with no row of their own therefore lit Dashboard — and on a group's
	 * page, Dashboard *and* the group, two rows at once (#1237).
	 */
	it('lights Dashboard for the dashboard and nothing else', () => {
		const wrong = memberPageRoutes()
			.filter((r) => r !== '/member')
			.filter((r) => activeMemberNavKey(ALL_ON, concrete(r)) === 'dashboard');

		expect(wrong, 'a panel root must match its own path exactly').toEqual([]);
		expect(activeMemberNavKey(ALL_ON, '/member')).toBe('dashboard');
	});

	it('keeps the no-row list honest', () => {
		const routes = new Set(memberPageRoutes());
		for (const route of reachedWithoutARow) expect(routes.has(route)).toBe(true);
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
		for (const route of reachedWithoutARow) expect(routes.has(route)).toBe(true);
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
