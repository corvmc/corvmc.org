import { describe, expect, it } from 'vitest';
import { flattenNav } from '$lib/components/layout/Nav/active-nav';
import { navTrail, type NavTrailGroup } from '$lib/components/layout/nav-trail';
import { staffNavSections, staffNavTop } from './staff/nav-items';
import { memberNavItems } from './member/nav-items';
import { bandNavItems } from './band/[slug]/nav-items';

/**
 * Breadcrumbs are derived from each panel's nav tree, so the trees themselves
 * are the fixtures: every row must yield a trail that ends at that row, and a
 * page beneath it must yield the row as a link (#1827).
 */
const panels: Record<string, NavTrailGroup[]> = {
	staff: [{ items: staffNavTop }, ...staffNavSections],
	member: [{ items: memberNavItems({ hasLoanableEquipment: true }) }],
	band: [
		{
			items: bandNavItems({
				slug: 'the-velvets',
				bandId: 'band-1',
				tier: 'premium',
				userRole: 'owner',
				isStaff: false,
				features: { bandAudio: true }
			})
		}
	]
};

describe.each(Object.entries(panels))('the %s panel', (_name, groups) => {
	const rows = flattenNav(groups.flatMap((g) => g.items)).filter((r) =>
		r.href.startsWith('/')
	) as NavTrailGroup['items'];
	const sectionTitles = new Set(groups.flatMap((g) => (g.title ? [g.title] : [])));

	it.each(rows.map((r) => [r.key, r] as const))(
		'row %s names itself, last and unlinked',
		(_k, row) => {
			const trail = navTrail(groups, row.href);
			expect(trail.here).toBe(true);
			expect(trail.crumbs.at(-1)).toEqual({ label: row.label });
			// Everything above the row is a link, or a section heading.
			for (const crumb of trail.crumbs.slice(0, -1)) {
				expect(crumb.href !== undefined || sectionTitles.has(crumb.label)).toBe(true);
			}
		}
	);

	it.each(rows.filter((r) => !r.exact).map((r) => [r.key, r] as const))(
		'a record under row %s trails through the row as a link',
		(_k, row) => {
			const trail = navTrail(groups, `${row.href}/record-1`);
			expect(trail.here).toBe(false);
			expect(trail.crumbs.at(-1)).toEqual({ label: row.label, href: row.href });
		}
	);
});
