import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
	activeNavKey,
	allStaffNavItems,
	childHrefsFor,
	sectionHasKey,
	staffNavSections,
	staffNavTop,
	type StaffNavKey
} from './nav-items';

/**
 * The staff sidebar's two long-standing defects were both invisible in the
 * template: `childHrefs` arrays that drifted from the routes they named, and an
 * exact-match `active` that lit no row at all on any detail page. Both are
 * assertable now that the nav is data, so this pins them.
 */

/** `/staff/users/[id]` → `/staff/users/x`, so a route can be fed to the matcher. */
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
		['/staff/users', 'users'],
		['/staff/users/abc', 'users'],
		['/staff/volunteer', 'volunteer'],
		// Not a nav row of its own — it falls back to the section parent.
		['/staff/volunteer/clearances', 'volunteer'],
		['/staff/volunteer/shifts/abc', 'volunteer-shifts'],
		['/staff/events/abc/check-in', 'events'],
		['/staff/equipment', 'equipment'],
		['/staff/equipment/abc', 'equipment'],
		['/staff/equipment/loans', 'equipment-loans'],
		['/staff/equipment/loans/abc', 'equipment-loans'],
		['/staff/marketing/campaigns/new', 'campaigns'],
		['/staff/marketing/campaigns/abc/edit', 'campaigns'],
		['/staff/help/create', 'help'],
		['/staff/settings', 'settings']
	];

	it.each(cases)('lights exactly one row for %s', (path, key) => {
		expect(activeNavKey(path)).toBe(key);
	});

	it('never matches a sibling that merely shares a prefix', () => {
		// The whole reason for the `href + '/'` test rather than bare `startsWith`.
		expect(activeNavKey('/staff/usersomething')).toBe('dashboard');
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
		// child sitting under its parent's path: Reservations groups `/staff/recurring`
		// and `/staff/closures`, which are siblings of it in the route tree.
		for (const item of allStaffNavItems()) {
			expect(activeNavKey(item.href)).toBe(item.key);
		}
	});

	it('keeps the parent in its own childHrefs', () => {
		const volunteer = staffNavSections.flatMap((s) => s.items).find((i) => i.key === 'volunteer')!;
		expect(childHrefsFor(volunteer)).toEqual([
			'/staff/volunteer',
			'/staff/volunteer/shifts',
			'/staff/volunteer/roles',
			'/staff/volunteer/certifications',
			'/staff/volunteer/report'
		]);
	});

	it('keeps Inbox out of every section, so its badge survives a collapsed group', () => {
		// e2e/inbox-awaiting-reply.e2e.ts selects `a[href="/staff/inbox"] .badge`.
		expect(staffNavTop.map((i) => i.key)).toContain('inbox');
		for (const section of staffNavSections) {
			expect(sectionHasKey(section, 'inbox')).toBe(false);
		}
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
		'/staff/volunteer/clearances', // reached from Certifications; `backHref` points there
		'/staff/help/create', // the create flow for Help Articles
		'/staff/marketing/campaigns/new' // the create flow for Campaigns
	]);

	it('leaves no staff page without a highlighted row', () => {
		const orphans = staffPageRoutes().filter((r) => activeNavKey(concrete(r)) === null);
		expect(orphans).toEqual([]);
	});

	it('gives every static staff page either a nav row or an explicit exemption', () => {
		const hrefs = new Set(allStaffNavItems().map((i) => i.href));
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
