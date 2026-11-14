import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
	activeNavKey,
	allStaffNavItems,
	filterNavItems,
	filterNavSections,
	sectionHasKey,
	staffNavSections,
	staffNavTop,
	type StaffNavItem,
	type StaffNavKey
} from './nav-items';
import { capabilities, positions, positionOrder, grantsCapability, surfaces } from '#lib/config.js';

/**
 * The staff sidebar's two long-standing defects were both invisible in the
 * template: `childHrefs` arrays that drifted from the routes they named, and an
 * exact-match `active` that lit no row at all on any detail page. Both are
 * assertable now that the nav is data, so this pins them.
 */

/** `/staff/members/[id]` → `/staff/members/x`, so a route can be fed to the matcher. */
function concrete(route: string): string {
	return route.replace(/\[[^\]]+\]/g, 'x');
}

function staffPageRoutes(): string[] {
	const root = join(process.cwd(), 'src/routes/staff');
	const routes: string[] = [];
	const walk = (dir: string, prefix: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.isDirectory()) {
				walk(join(dir, entry.name), `${prefix}/${entry.name}`);
			} else if (entry.name === '+page.svelte') {
				routes.push(prefix);
			}
		}
	};
	walk(root, '/staff');
	return routes.sort();
}

describe('activeNavKey', () => {
	const cases: [string, StaffNavKey][] = [
		['/staff', 'dashboard'],
		['/staff/', 'dashboard'],
		['/staff/inbox', 'inbox'],
		['/staff/inbox/abc', 'inbox'],
		['/staff/members', 'users'],
		['/staff/members/abc', 'users'],
		['/staff/ballots/abc', 'ballots'],
		['/staff/groups', 'groups'],
		['/staff/groups/abc', 'groups'],
		// Volunteering owns the rest of the path (#2379, #2625).
		['/staff/volunteering', 'volunteer-schedule'],
		['/staff/volunteer', 'volunteer-schedule'],
		['/staff/members/volunteers', 'users'],
		['/staff/volunteer/roles', 'volunteer-schedule'],
		// Every task's page, and Recurring, are Tasks views (#2625).
		['/staff/tasks/abc', 'projects'],
		['/staff/tasks/recurring', 'projects'],
		['/staff/tasks/projects/abc', 'projects'],
		// `/staff/events/[id]` and everything under it is the general view, which
		// the Calendar row owns — including the production console, which is a
		// page you navigate to rather than a section of its own.
		['/staff/events/abc/check-in', 'calendar'],
		['/staff/events/abc/production', 'calendar'],
		['/staff/tasks/productions', 'projects'],
		['/staff/contacts', 'contacts'],
		['/staff/contacts/abc', 'contacts'],
		['/staff/funding', 'funding'],
		// A sponsor's page is its Contacts page now (#2764); old links redirect.
		['/staff/sponsors', 'contacts'],
		['/staff/sponsors/abc', 'contacts'],
		['/staff/grants', 'funding'],
		['/staff/grants/abc', 'funding'],
		['/staff/grants/funders', 'funding'],
		['/staff/inventory', 'gear'],
		['/staff/inventory/abc', 'gear'],
		['/staff/inventory/intake', 'gear'],
		// Gear and Supplies split the list (#2573); Supplies is the longer match.
		['/staff/inventory/supplies', 'supplies'],
		// Restock and Orders are views of the list now (#2021, #2022); an order's page stays.
		['/staff/inventory/orders/abc', 'gear'],
		['/staff/inventory/spend', 'reports'],
		['/staff/inventory/acquisitions/abc', 'reports'],
		// Loans, reported problems and compliance are Gear's tabs; their URLs did not move.
		['/staff/inventory/compliance', 'gear'],
		['/staff/inventory/loans', 'gear'],
		['/staff/inventory/loans/abc', 'gear'],
		['/staff/reservations/abc', 'reservations'],
		['/staff/recurring/abc', 'reservations'],
		['/staff/inventory/problems', 'gear'],
		['/staff/inventory/problems/abc', 'gear'],
		['/staff/contractors', 'contacts'],
		['/staff/contractors/abc', 'contacts'],
		// Records keep their addresses under the row they moved to (#2393).
		['/staff/moderation', 'moderation'],
		['/staff/moderation/flags', 'moderation'],
		['/staff/moderation/incidents', 'moderation'],
		['/staff/flags/abc', 'moderation'],
		['/staff/incidents/abc', 'moderation'],
		['/staff/reports', 'reports'],
		['/staff/reports/annual', 'reports'],
		['/staff/reports/volunteering', 'reports'],
		['/staff/reports/inventory-spend', 'reports'],
		['/staff/reports/acquisitions', 'reports'],
		['/staff/volunteering/hours', 'volunteer-schedule'],
		['/staff/members/instructors', 'users'],
		['/staff/members/invites', 'users'],
		['/staff/money', 'payments'],
		['/staff/money/payments', 'payments'],
		['/staff/money/credits', 'payments'],
		['/staff/content', 'content'],
		['/staff/help', 'content'],
		['/staff/marketing', 'outreach'],
		['/staff/marketing/campaigns', 'outreach'],
		['/staff/marketing/audiences/abc', 'outreach'],
		['/staff/marketing/campaigns/new', 'outreach'],
		['/staff/marketing/campaigns/abc/edit', 'outreach'],
		['/staff/help/create', 'content'],
		['/staff/local-resources', 'content'],
		['/staff/local-resources/categories', 'content'],
		['/staff/settings', 'settings'],
		['/staff/audit', 'audit']
	];

	it.each(cases)('lights exactly one row for %s', (path, key) => {
		expect(activeNavKey(path)).toBe(key);
	});

	it('never matches a sibling that merely shares a prefix', () => {
		// The whole reason for the `href + '/'` test rather than bare `startsWith`.
		// This used to expect 'dashboard', because `/staff` matched every path in
		// the panel as a prefix. That fallback was the #1237 bug — it lit the
		// Dashboard row on pages that are not the dashboard — so the root is now
		// `exact` and an unrecognised path lights nothing.
		expect(activeNavKey('/staff/membersomething')).toBeNull();
		expect(activeNavKey('/staffing')).toBeNull();
	});

	it('returns null outside the panel', () => {
		expect(activeNavKey('/member/reservations')).toBeNull();
	});
});

describe('the nav tree', () => {
	it('has unique keys and unique hrefs', () => {
		const items = allStaffNavItems();
		expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
		expect(new Set(items.map((i) => i.href)).size).toBe(items.length);
	});

	it('resolves every row to its own key, so no row is shadowed by another', () => {
		// The property `activeNavKey` actually needs. Note it holds without every
		// child sitting under its parent's path: Volunteering's rows do, but
		// Reservations claims `/staff/recurring` through `also`.
		for (const item of allStaffNavItems()) {
			expect(activeNavKey(item.href)).toBe(item.key);
		}
	});

	it('folds the volunteer and instructor rosters into Members (#2074)', () => {
		const members = allStaffNavItems().find((i) => i.key === 'users')!;
		expect(filterNavItems([members], ['volunteer.read'])).toHaveLength(1);
		expect(filterNavItems([members], ['instructor.read'])).toHaveLength(1);
		expect(filterNavItems([members], ['band.read'])).toHaveLength(0);
	});

	it('keeps the volunteer badge and gate on Volunteering (#2379, #2625)', () => {
		const schedule = allStaffNavItems().find((i) => i.key === 'volunteer-schedule')!;
		expect(schedule.badgeKey).toBe('volunteerPending');
		expect(filterNavItems([schedule], ['volunteer.read'])).toHaveLength(1);
		expect(allStaffNavItems().some((i) => i.href === '/staff/volunteer')).toBe(false);
	});

	it('folds Productions into Tasks (#2101, #2625)', () => {
		const projects = allStaffNavItems().find((i) => i.key === 'projects')!;
		expect(filterNavItems([projects], ['event.manage'])).toHaveLength(1);
		expect(filterNavItems([projects], ['event.read'])).toHaveLength(0);
	});

	it('folds Bands, Clubs and Committees into Groups (#2086)', () => {
		const groups = allStaffNavItems().find((i) => i.key === 'groups')!;
		expect(filterNavItems([groups], ['band.read'])).toHaveLength(1);
		expect(filterNavItems([groups], ['group.read'])).toHaveLength(1);
		expect(filterNavItems([groups], ['committee.reviewApplications'])).toHaveLength(1);
		expect(filterNavItems([groups], ['event.read'])).toHaveLength(0);
	});

	it('reaches Project Templates through Tasks (#2385, #2625)', () => {
		expect(activeNavKey('/staff/tasks/templates')).toBe('projects');
		expect(activeNavKey('/staff/tasks/templates/abc')).toBe('projects');
	});

	it('keeps Inbox out of every section, so its badge survives a collapsed group', () => {
		// e2e/inbox-awaiting-reply.e2e.ts selects `a[href="/staff/inbox"] .badge`.
		expect(staffNavTop.map((i) => i.key)).toContain('inbox');
		for (const section of staffNavSections) {
			expect(sectionHasKey(section, 'inbox')).toBe(false);
		}
	});

	// Submissions waiting on a decision are one badge, on the review feed (#2623).
	it('badges only the Dashboard, Inbox and Volunteering', () => {
		const badged = allStaffNavItems()
			.filter((i) => i.badgeKey)
			.map((i) => [i.key, i.badgeKey]);
		expect(badged).toEqual([
			['dashboard', 'reviewWaiting'],
			['inbox', 'inboxUnread'],
			['volunteer-schedule', 'volunteerPending']
		]);
	});

	it('holds Help articles and Local resources in one Content row (#2765)', () => {
		const content = allStaffNavItems().find((i) => i.key === 'content');
		expect(content?.children).toBeUndefined();
		expect(activeNavKey('/staff/help/abc')).toBe('content');
		expect(activeNavKey('/staff/local-resources/abc')).toBe('content');
	});

	// The #1788 regrouping: each row in the section that owns what it is about.
	it('groups rows by what they are about', () => {
		const section = (key: string) => staffNavSections.find((s) => s.key === key)!;
		const keys = (key: string) => section(key).items.map((i) => i.key);
		expect(keys('people')).toEqual(['users', 'groups']);
		expect(keys('planning')).toEqual(['suggestions', 'ballots', 'projects', 'volunteer-schedule']);
		// Recurring work is a Tasks setting (#2087, #2767).
		expect(activeNavKey('/staff/tasks/recurring')).toBe('projects');
		expect(keys('space')).toEqual(['reservations', 'gear', 'supplies']);
		// Building access is a Practice space view (#2766), not a row.
		expect(activeNavKey('/staff/building-access')).toBe('reservations');
		expect(keys('partners')).toEqual(['contacts', 'funding', 'venues', 'content']);
		expect(keys('moderation')).toEqual(['moderation', 'classifieds']);
		expect(keys('outreach')).toEqual(['outreach']);
		expect(keys('money')).not.toContain('grants');
		expect(keys('reports')).toEqual(['reports']);
		expect(staffNavTop.map((i) => i.key)).toEqual(['dashboard', 'inbox', 'calendar']);
	});

	// A show's door takings are on its staff page (#1809); the till is reached from there.
	it('has no Door Sales row', () => {
		const hrefs = allStaffNavItems().map((i) => i.href);
		expect(hrefs.some((h) => h.includes('/member/volunteer/door'))).toBe(false);
		expect(allStaffNavItems().map((i) => i.key)).not.toContain('door-sales');
	});

	it('finds the owning section for every row', () => {
		for (const item of allStaffNavItems()) {
			if (staffNavTop.some((t) => t.key === item.key)) continue;
			const owners = staffNavSections.filter((s) => sectionHasKey(s, item.key));
			expect(owners).toHaveLength(1);
		}
	});
});

describe('route coverage', () => {
	/**
	 * Pages that are deliberately not their own nav row. Each is reachable from
	 * the page that owns it, and each still resolves to a highlighted parent.
	 */
	const unlinked = new Set([
		// The full hour-log queue, reached from Volunteering's header (#2765).
		'/staff/volunteering/hours',
		// Roles and clearances: reached from Volunteering's header (#1791).
		'/staff/volunteer/roles',
		'/staff/tasks/projects', // a Tasks view (#2625)
		'/staff/tasks/productions', // a Tasks view (#2101, #2625)
		'/staff/tasks/templates', // a Tasks setting, from its header (#2767)
		'/staff/tasks/recurring', // a Tasks setting, from its header (#2767)
		// Content's views, reached from its tab bar (#2765).
		'/staff/help',
		'/staff/local-resources',
		'/staff/help/create', // the create flow for Help Articles
		'/staff/marketing/campaigns/new', // the create flow for Campaigns
		'/staff/inventory/locations', // reached from Gear and Supplies, beside Categories
		'/staff/inventory/intake', // a session started from Gear or Supplies, not a list (#1838)
		// Gear's tabs (#2573).
		'/staff/inventory/loans',
		'/staff/inventory/problems',
		'/staff/inventory/compliance',
		'/staff/local-resources/categories', // reached from Local Resources' header, like inventory's
		'/staff/recurring', // a Practice space view (#2766)
		'/staff/building-access', // a Practice space view (#2766)
		'/staff/reservations/settings', // reached from Practice space's header (#2586)
		// Moderation views, reached from its tab bar (#2393).
		'/staff/moderation/flags',
		'/staff/moderation/incidents',
		'/staff/moderation/blocklist',
		// Outreach views, reached from its tab bar (#2394).
		'/staff/marketing/campaigns',
		'/staff/marketing/audiences',
		'/staff/marketing/posters',
		// Payments views, reached from its tab bar (#2395).
		'/staff/money/payments',
		'/staff/money/credits',
		// Reports views, reached from its tab bar (#2396).
		'/staff/reports/annual',
		'/staff/reports/volunteering',
		'/staff/reports/inventory-spend',
		'/staff/reports/acquisitions',
		'/staff/reports/music',
		// Started from the Inbox header, and only worth starting when the queue
		// has something in it. A nav row would offer a session that is empty most
		// of the day, from a place that cannot tell you whether it is.
		'/staff/inbox/daily',
		// Contacts' duplicate view (#2622), reached from the Contacts header.
		'/staff/contacts/duplicates'
	]);

	it('leaves no staff page without a highlighted row', () => {
		const orphans = staffPageRoutes().filter((r) => activeNavKey(concrete(r)) === null);
		expect(orphans).toEqual([]);
	});

	it('gives every static staff page either a nav row or an explicit exemption', () => {
		const hrefs = new Set<string>(allStaffNavItems().map((i) => i.href));
		const missing = staffPageRoutes()
			.filter((r) => !r.includes('['))
			.filter((r) => !hrefs.has(r) && !unlinked.has(r));
		expect(missing).toEqual([]);
	});

	it('keeps the exemption list honest', () => {
		const routes = new Set(staffPageRoutes());
		for (const route of unlinked) expect(routes.has(route)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Capability filtering.
//
// Hiding a row is not a guard — `requireCapability` on the remote function is.
// This only stops someone being offered a link that would 403, which is the
// difference between a panel that is narrower for a treasurer and one that is
// visibly broken for them.
// ---------------------------------------------------------------------------

const everyCapability = Object.entries(capabilities).flatMap(([r, actions]) =>
	(actions as readonly string[]).map((a) => `${r}.${a}`)
);

describe('nav capability annotations', () => {
	it('names a real capability on every gated row', () => {
		// A typo here is not a type error at the call site — it is a nav row that
		// is hidden from everyone, forever, silently.
		for (const item of allStaffNavItems()) {
			if (!item.capability) continue;
			expect(everyCapability, `${item.key} names ${item.capability}`).toContain(item.capability);
		}
	});

	it('gates every row except the dashboard', () => {
		const ungated = allStaffNavItems()
			.filter((i) => !i.capability)
			.map((i) => i.key);
		expect(ungated).toEqual(['dashboard']);
	});

	it('leaves no row unreachable by every position at once', () => {
		// A row nobody can see is a page nobody can find. Checked against the union
		// of all positions rather than admin alone, so it still means something
		// after staff is narrowed.
		for (const item of allStaffNavItems()) {
			if (!item.capability) continue;
			const reachable = positionOrder.some((p) => grantsCapability(positions[p], item.capability!));
			expect(reachable, `${item.key} is unreachable`).toBe(true);
		}
	});
});

describe('filterNavItems', () => {
	const tree: StaffNavItem[] = [
		{ key: 'dashboard' as StaffNavKey, label: 'Dashboard', href: '/staff' },
		{
			key: 'equipment' as StaffNavKey,
			label: 'Inventory',
			href: '/staff/inventory',
			capability: 'inventory.read',
			children: [
				{
					key: 'inventory-orders' as StaffNavKey,
					label: 'Orders',
					href: '/staff/inventory/orders',
					capability: 'inventory.manageOrders'
				}
			]
		}
	];

	it('keeps an ungated row', () => {
		expect(filterNavItems(tree, []).map((i) => i.key)).toEqual(['dashboard']);
	});

	it('drops a parent whose children all fail, even when the parent passes', () => {
		// The case that matters. Keeping the parent would open a Collapsible onto
		// nothing, which reads as broken rather than as empty.
		const held = ['inventory.read'];
		expect(filterNavItems(tree, held).map((i) => i.key)).toEqual(['dashboard']);
	});

	it('keeps a parent with at least one usable child', () => {
		const held = ['inventory.read', 'inventory.manageOrders'];
		const out = filterNavItems(tree, held);
		expect(out.map((i) => i.key)).toEqual(['dashboard', 'equipment']);
		expect(out[1].children?.map((c) => c.key)).toEqual(['inventory-orders']);
	});

	it('does not mutate the source tree', () => {
		filterNavItems(tree, ['inventory.read', 'inventory.manageOrders']);
		expect(tree[1].children).toHaveLength(1);
	});
});

describe('filterNavSections', () => {
	it('drops a section once its last row goes', () => {
		expect(filterNavSections(staffNavSections, [])).toEqual([]);
	});

	it('gives admin the whole nav back', () => {
		const held = everyCapability;
		const kept = filterNavSections(staffNavSections, held);
		expect(kept.map((s) => s.key)).toEqual(staffNavSections.map((s) => s.key));
	});

	it('gives a treasurer a narrower panel, with Money in it', () => {
		const held = everyCapability.filter((c) => grantsCapability(positions.treasurer, c as never));
		const kept = filterNavSections(staffNavSections, held);
		const keys = kept.map((s) => s.key);
		expect(keys).toContain('money');
		expect(keys.length).toBeLessThan(staffNavSections.length);
	});
});

describe('surfaces switched off in code (#2116)', () => {
	const keys = () =>
		filterNavSections(staffNavSections, ['ballot.manage', 'listing.review']).flatMap((sec) =>
			sec.items.map((i) => i.key)
		);

	it('drops Ballots and Classifieds for everyone while off, and keeps them once on', () => {
		const saved = { ...surfaces };
		try {
			surfaces.ballots = false;
			surfaces.classifieds = false;
			expect(keys()).not.toContain('ballots');
			expect(keys()).not.toContain('classifieds');
			surfaces.ballots = true;
			surfaces.classifieds = true;
			expect(keys()).toEqual(expect.arrayContaining(['ballots', 'classifieds']));
		} finally {
			Object.assign(surfaces, saved);
		}
	});
});
