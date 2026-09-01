/**
 * The panel switcher's tabs — Member, Staff if you are staff, then one per band.
 *
 * The same block was written out three times, once per panel layout, differing
 * only in whether the Staff tab was conditional. The staff panel's own copy
 * included it unconditionally, which is right but only by luck of being inside
 * it: `getStaffLayout` has already redirected anyone without the role, so
 * `isStaff` is true there by construction.
 */

import { resolve } from '$app/paths';
import type { PanelTab } from './AppTopbar.svelte';

export interface PanelTabsInput {
	isStaff?: boolean;
	userBands: { slug: string; name: string }[];
}

export function panelTabs(input: PanelTabsInput): PanelTab[] {
	return [
		{ key: 'member', label: 'Member', href: resolve('/member'), type: 'member' },
		...(input.isStaff
			? [{ key: 'staff', label: 'Staff', href: resolve('/staff'), type: 'staff' as const }]
			: []),
		...input.userBands.map((b) => ({
			key: b.slug,
			label: b.name,
			href: resolve(`/band/${b.slug}`),
			type: 'band' as const
		}))
	];
}
