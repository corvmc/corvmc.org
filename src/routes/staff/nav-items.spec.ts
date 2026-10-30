import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
	activeNavKey,
	allStaffNavItems,
	childHrefsFor,
	filterNavItems,
	filterNavSections,
	sectionHasKey,
	staffNavSections,
	staffNavTop,
	type StaffNavItem,
	type StaffNavKey
} from './nav-items';
import { capabilities, positions, positionOrder, grantsCapability, surfaces } from '$lib/config';

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
		['/staff/clubs', 'clubs'],
		['/staff/clubs/abc', 'clubs'],
		['/staff/committees', 'committees'],
		['/staff/committees/abc', 'committees'],
		['/staff/volunteer', 'volunteer'],
		['/staff/members/volunteers', 'users'],
		['/staff/volunteer/roles', 'volunteer'],
		// Shift detail lost its own row when the catalog folded into Schedule; it
		// falls back to the section parent like clearances does.
		['/staff/volunteer/shifts/abc', 'volunteer'],
		// `/staff/events/[id]` and everything under it is the general view, which
		// the Calendar row owns — including the production console, which is a
		// page you navigate to rather than a section of its own.
		['/staff/events/abc/check-in', 'calendar'],
		['/staff/events/abc/production', 'calendar'],
		['/staff/projects/productions', 'projects'],
		['/staff/sponsors', 'sponsors'],
		['/staff/sponsors/abc', 'sponsors'],
		['/staff/grants', 'grants'],
		['/staff/grants/abc', 'grants'],
		['/staff/renewals', 'renewals'],
		['/staff/renewals/abc', 'renewals'],
		['/staff/grants/funders', 'grants'],
		['/staff/inventory', 'equipment'],
		['/staff/inventory/abc', 'equipment'],
		['/staff/inventory/intake', 'equipment'],
		['/staff/inventory/restock', 'inventory-restock'],
		['/staff/inventory/spend', 'inventory-spend'],
		['/staff/inventory/compliance', 'inventory-compliance'],
		// Loans left Inventory's children for a row of its own; its URL did not move.
		['/staff/inventory/loans', 'equipment-loans'],
		['/staff/inventory/loans/abc', 'equipment-loans'],
		['/staff/reservations/abc', 'reservations'],
		['/staff/recurring/abc', 'reservations'],
		['/staff/inventory/problems', 'equipment-reports'],
		['/staff/inventory/problems/abc', 'equipment-reports'],
		['/staff/contractors', 'contractors'],
		['/staff/contractors/abc', 'contractors'],
		['/staff/incidents', 'incidents'],
		['/staff/incidents/abc', 'incidents'],
		['/staff/volunteer/report', 'volunteer-report'],
		['/staff/members/instructors', 'users'],
		['/staff/help', 'help'],
		['/staff/marketing/campaigns/new', 'campaigns'],
		['/staff/marketing/campaigns/abc/edit', 'campaigns'],
		['/staff/help/create', 'help'],
		['/staff/local-resources', 'local-resources'],
		['/staff/local-resources/categories', 'local-resources'],
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
		const volunteer = allStaffNavItems().find((i) => i.key === 'volunteer')!;
		expect(volunteer.children).toBeUndefined();
		expect(childHrefsFor(volunteer)).toEqual(['/staff/volunteer']);
		const members = allStaffNavItems().find((i) => i.key === 'users')!;
		expect(filterNavItems([members], ['volunteer.read'])).toHaveLength(1);
		expect(filterNavItems([members], ['instructor.read'])).toHaveLength(1);
		expect(filterNavItems([members], ['band.read'])).toHaveLength(0);
	});

	it('folds Productions into Projects (#2101)', () => {
		const projects = allStaffNavItems().find((i) => i.key === 'projects')!;
		expect(filterNavItems([projects], ['event.manage'])).toHaveLength(1);
		expect(filterNavItems([projects], ['event.read'])).toHaveLength(0);
	});

	it('puts Project Templates under Planning, beside Projects (#2034)', () => {
		const planning = staffNavSections.find((s) => s.key === 'planning')!;
		const keys = planning.items.map((i) => i.key);
		expect(keys.indexOf('project-templates')).toBe(keys.indexOf('projects') + 1);
		expect(activeNavKey('/staff/project-templates/abc')).toBe('project-templates');
	});

	it('keeps Inbox out of every section, so its badge survives a collapsed group', () => {
		// e2e/inbox-awaiting-reply.e2e.ts selects `a[href="/staff/inbox"] .badge`.
		expect(staffNavTop.map((i) => i.key)).toContain('inbox');
		for (const section of staffNavSections) {
			expect(sectionHasKey(section, 'inbox')).toBe(false);
		}
	});

	it('puts the resource tips queue under Local Resources, with its pending count', () => {
		expect(staffNavTop.map((i) => i.key)).not.toContain('resource-tips');
		const parent = allStaffNavItems().find((i) => i.key === 'local-resources');
		expect(parent?.badgeKey).toBe('resourceTipsPending');
		const tips = parent?.children?.find((i) => i.key === 'resource-tips');
		expect(tips).toMatchObject({
			href: '/staff/local-resources/tips',
			badgeKey: 'resourceTipsPending',
			capability: 'localResource.manage'
		});
		expect(activeNavKey('/staff/local-resources/tips')).toBe('resource-tips');
		expect(activeNavKey('/staff/local-resources')).toBe('local-resources');
	});

	// The #1788 regrouping: each row in the section that owns what it is about.
	it('groups rows by what they are about', () => {
		const section = (key: string) => staffNavSections.find((s) => s.key === key)!;
		const keys = (key: string) => section(key).items.map((i) => i.key);
		expect(keys('people')).toEqual(['users', 'bands', 'clubs', 'committees', 'volunteer']);
		expect(keys('planning')).toEqual([
			'suggestions',
			'ballots',
			'projects',
			'project-templates',
			'volunteer-schedule',
			'recurring-work'
		]);
		expect(keys('space')).toEqual([
			'reservations',
			'equipment',
			'equipment-loans',
			'renewals',
			'keys'
		]);
		expect(keys('partners')).toEqual(['sponsors', 'venues', 'local-resources', 'contractors']);
		expect(keys('moderation')).toEqual(['flags', 'classifieds', 'incidents']);
		expect(keys('outreach')).toEqual(['campaigns', 'audiences']);
		expect(keys('money')).toContain('grants');
		expect(keys('reports')).toEqual([
			'reports',
			'volunteer-report',
			'inventory-spend',
			// A record of when stock arrived; each item's page shows its own (#1841).
			'inventory-acquisitions'
		]);
		expect(keys('system')).toContain('help');
		expect(keys('events')).toEqual(['calendar']);
	});

	// A show's door takings are on its staff page (#1809); the till is reached from there.
	it('has no Door Sales row', () => {
		const hrefs = allStaffNavItems().map((i) => i.href);
		expect(hrefs.some((h) => h.includes('/member/volunteer/door'))).toBe(false);
		expect(allStaffNavItems().map((i) => i.label)).not.toContain('Door Sales');
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
		// The full hour-log queue. Today's "Hours to review" card shows the top five
		// and links here for the rest; it is not its own nav row because reviewing
		// hours is something you arrive at from the worklist, not something you go
		// and browse.
		'/staff/volunteer/hours',
		// Roles and clearances: reached from the Volunteering dashboard's header (#1791).
		'/staff/volunteer/roles',
		// Members views, reached from its tab bar (#2074).
		'/staff/members/volunteers',
		'/staff/members/instructors',
		'/staff/projects/productions', // a Projects view (#2101)
		'/staff/help/create', // the create flow for Help Articles
		'/staff/marketing/campaigns/new', // the create flow for Campaigns
		'/staff/inventory/locations', // reached from Inventory, beside Categories; its breadcrumb runs through it
		'/staff/inventory/intake', // a session started from Inventory's header, not a list (#1838)
		'/staff/local-resources/categories', // reached from Local Resources' header, like inventory's
		'/staff/grants/funders', // reached from Grants' header; its breadcrumb runs through it
		// Reached from Bands, which links to it in its header. Not its own row on
		// purpose: an external act is the same staff job as a band — who is
		// playing here — and one of them can turn into the other, so splitting
		// them in the nav would imply two jobs where there is one.
		'/staff/bands/acts',
		// Started from the Inbox header, and only worth starting when the queue
		// has something in it. A nav row would offer a session that is empty most
		// of the day, from a place that cannot tell you whether it is.
		'/staff/inbox/daily'
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
