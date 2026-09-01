/**
 * Which nav entries a band panel shows, as data.
 *
 * Pulled out of the layout template because this gating has been wrong twice.
 * Settings and Subscription were both keyed on `userRole === 'owner'`, and
 * `getBandLayout` returns `role ?? 'staff'` — so an admin, and any staff member
 * viewing a band they don't belong to, saw no Settings entry and had no route to
 * the band's own address. As a template of nested `{#if}`s the mistake was
 * invisible; as a list it can be asserted against, which `nav-items.spec.ts`
 * does for every role and flag combination.
 */
import { activeNavKey, type NavNode } from '$lib/components/layout/Nav/active-nav';

export type BandNavKey =
	| 'dashboard'
	| 'members'
	| 'announcements'
	| 'reservations'
	| 'events'
	| 'edit'
	| 'page-editor'
	| 'live-site'
	| 'subscription'
	| 'settings'
	| 'staff-tools';

export interface BandNavInput {
	slug: string;
	bandId: string;
	tier: string;
	userRole: string;
	isStaff: boolean;
	features: { bandPremium?: boolean; announcements?: boolean };
}

export interface BandNavItem extends NavNode<BandNavKey> {
	label: string;
	/**
	 * Absolute, inside the panel. An `external` row's href leaves the origin and
	 * is filled in by the layout, which is the only place that knows the band's
	 * custom domain — it stays empty here, and `activeBandNavKey` skips it.
	 */
	href: string;
	external?: boolean;
}

export function bandNavItems(input: BandNavInput): BandNavItem[] {
	const base = `/band/${input.slug}`;
	const isOwner = input.userRole === 'owner';
	const isOwnerOrAdmin = isOwner || input.userRole === 'admin';
	const premium = !!input.features.bandPremium && input.tier === 'premium';

	const items: BandNavItem[] = [
		{ key: 'dashboard', label: 'Dashboard', href: base },
		{ key: 'members', label: 'Members', href: `${base}/members` }
	];

	// Announcements used to sit here behind an `announcements` flag, whose comment
	// said the fan-out behind Publish was unbuilt. It has been built since —
	// `announcement.published` has a listener with a latch — but the module is not
	// launched, so the nav entry is absent and the route answers by direct URL
	// only. Launching is putting this row back; see
	// docs/plans/feature-flag-retirement.md.

	// Reservations used to sit behind a `bandReservations` flag, retired on main
	// in #238's wake — band booking is simply on now.
	items.push({ key: 'reservations', label: 'Reservations', href: `${base}/reservations` });
	items.push({ key: 'events', label: 'Events', href: `${base}/events` });

	if (isOwnerOrAdmin) {
		items.push({ key: 'edit', label: 'Edit Profile', href: `${base}/edit` });
	}

	if (premium && isOwnerOrAdmin) {
		items.push({ key: 'page-editor', label: 'Page Editor', href: `${base}/page-editor` });
		items.push({ key: 'live-site', label: 'View Live Site', href: '', external: true });
	}

	if (isOwnerOrAdmin) {
		// Billing is genuinely owner-only — `upgradeToPremium` and friends are
		// `requireBandOwner` — so unlike Settings this one stays keyed on owner.
		if (input.features.bandPremium && isOwner) {
			items.push({ key: 'subscription', label: 'Subscription', href: `${base}/subscription` });
		}
		// Admins get Settings: the page shows them the band's address read-only,
		// which is the thing they could not reach at all before.
		items.push({ key: 'settings', label: 'Settings', href: `${base}/settings` });
	} else if (input.isStaff) {
		// A staff non-member resolves to the pseudo-role 'staff'. Every control on
		// the settings page is owner-guarded, so send them where they can act.
		items.push({ key: 'staff-tools', label: 'Staff tools', href: `/staff/bands/${input.bandId}` });
	}

	return items;
}

/**
 * Which row to light up. Band detail pages — `/band/x/events/<id>` and the EPK
 * editor under `/band/x/page-editor` — lit nothing before this, because
 * `NavItem` matches the pathname exactly on its own.
 */
export function activeBandNavKey(input: BandNavInput, pathname: string): BandNavKey | null {
	return activeNavKey(bandNavItems(input), pathname);
}
