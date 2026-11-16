/**
 * Which nav entries a band panel shows, as data.
 *
 * Pulled out of the layout template because this gating has been wrong twice:
 * Settings keyed on `userRole === 'owner'` hid it from admins and staff, since
 * `getBandLayout` returns `role ?? 'staff'`. As a list it can be asserted
 * against for every role and flag combination, which `nav-items.spec.ts` does.
 *
 * Three zones: Dashboard on top, sections that each answer one question (#3129,
 * the staff nav's shape from #3112), and what the band administers at the foot.
 */
import { resolve } from '$app/paths';
import { activeNavKey, type NavNode } from '#lib/components/layout/Nav/active-nav.js';

export type BandNavKey =
	| 'dashboard'
	| 'messages'
	| 'members'
	| 'rider'
	| 'packing'
	| 'announcements'
	| 'reservations'
	| 'events'
	| 'music'
	| 'payouts'
	| 'edit'
	| 'press-kit'
	| 'page-editor'
	| 'subscription'
	| 'settings'
	| 'staff-tools';

export type BandNavSectionKey = 'schedule' | 'band' | 'profile' | 'stage' | 'music';

/** Field names on `getBandLayout()`'s return, so the nav itself stays plain data. */
export type BandNavBadgeKey = 'inboxUnread';

export interface BandNavInput {
	slug: string;
	bandId: string;
	tier: string;
	userRole: string;
	isStaff: boolean;
	features: { bandAudio?: boolean };
}

export interface BandNavItem extends NavNode<BandNavKey> {
	label: string;
	badgeKey?: BandNavBadgeKey;
}

export interface BandNavSection {
	/** Stable id. The remembered collapse state keys off this, never the title. */
	key: BandNavSectionKey;
	title: string;
	items: BandNavItem[];
}

function gates(input: BandNavInput) {
	const isOwner = input.userRole === 'owner';
	return { isOwner, isOwnerOrAdmin: isOwner || input.userRole === 'admin' };
}

/** Above the first section. */
export function bandNavTop(input: BandNavInput): BandNavItem[] {
	// Not `exact`, unlike the member panel's. A row can be hidden by role, and a
	// viewer on a page whose row they cannot see lands on the panel root rather
	// than on nothing; `nav-items.spec.ts` pins that.
	return [
		{ key: 'dashboard', label: 'Dashboard', href: resolve('/band/[slug]', { slug: input.slug }) }
	];
}

/** The sections, each dropped once the viewer can see none of its rows. */
export function bandNavSections(input: BandNavInput): BandNavSection[] {
	const slug = input.slug;
	const { isOwnerOrAdmin } = gates(input);
	const premium = input.tier === 'premium';

	const schedule: BandNavItem[] = [
		{
			key: 'reservations',
			label: 'Reservations',
			href: resolve('/band/[slug]/reservations', { slug })
		},
		{ key: 'events', label: 'Events', href: resolve('/band/[slug]/events', { slug }) }
	];

	// Every member reads announcements and the band chat; the pages gate who
	// posts, and the Messages page draws enquiries only for an owner or admin.
	// `requireGroupRole` behind each is the guard.
	const band: BandNavItem[] = [
		{ key: 'members', label: 'Members', href: resolve('/band/[slug]/members', { slug }) },
		{
			key: 'announcements',
			label: 'Announcements',
			href: resolve('/band/[slug]/announcements', { slug })
		},
		// A row again (#3136): the topbar icon's badge counts every inbox the
		// viewer reads, so it cannot say whether this band has an enquiry.
		{
			key: 'messages',
			label: 'Messages',
			href: resolve('/band/[slug]/messages', { slug }),
			badgeKey: 'inboxUnread'
		}
	];

	// Every member reads the profile and press kit; only owners and admins edit
	// them, which each page and each write remote decides. The press kit is kept
	// apart from the profile: one is what the public sees, the other what a venue
	// is sent.
	const isMember = isOwnerOrAdmin || input.userRole === 'member';
	const profile: BandNavItem[] = isMember
		? [
				{ key: 'edit', label: 'Band profile', href: resolve('/band/[slug]/edit', { slug }) },
				{ key: 'press-kit', label: 'Press kit', href: resolve('/band/[slug]/press-kit', { slug }) }
			]
		: [];
	if (premium && isOwnerOrAdmin) {
		profile.push({
			key: 'page-editor',
			label: 'Page editor',
			href: resolve('/band/[slug]/page-editor', { slug })
		});
	}

	// Every role, staff included: the member who owns the amp is the one who can
	// say what it needs. A member's save only ever touches their own rows.
	const stage: BandNavItem[] = [
		{ key: 'rider', label: 'Tech rider', href: resolve('/band/[slug]/rider', { slug }) },
		{ key: 'packing', label: 'Packing list', href: resolve('/band/[slug]/packing', { slug }) }
	];

	// Releases for every member, Payouts (banking) for owner and admin. Switched
	// off by the flag for everyone, the premium tier included.
	const music: BandNavItem[] = [];
	if (input.features.bandAudio) {
		music.push({ key: 'music', label: 'Releases', href: resolve('/band/[slug]/music', { slug }) });
		if (isOwnerOrAdmin) {
			music.push({
				key: 'payouts',
				label: 'Payouts',
				href: resolve('/band/[slug]/music/payouts', { slug })
			});
		}
	}

	const sections: BandNavSection[] = [
		{ key: 'schedule', title: 'Schedule', items: schedule },
		{ key: 'band', title: 'Band', items: band },
		{ key: 'profile', title: 'Profile', items: profile },
		{ key: 'stage', title: 'Stage', items: stage },
		{ key: 'music', title: 'Music', items: music }
	];
	return sections.filter((s) => s.items.length > 0);
}

/**
 * The rows a spacer pins to the foot: administering the band rather than
 * running it. Empty for a plain member.
 */
export function bandNavFooter(input: BandNavInput): BandNavItem[] {
	const { isOwner, isOwnerOrAdmin } = gates(input);
	const items: BandNavItem[] = [];

	if (isOwnerOrAdmin) {
		// Billing is `requireBandOwner` on the server, so owner only.
		if (isOwner) {
			items.push({
				key: 'subscription',
				label: 'Subscription',
				href: resolve('/band/[slug]/subscription', { slug: input.slug })
			});
		}
		items.push({
			key: 'settings',
			label: 'Settings',
			href: resolve('/band/[slug]/settings', { slug: input.slug })
		});
	} else if (input.isStaff) {
		// A staff non-member resolves to the pseudo-role 'staff', and every
		// settings control is owner-guarded, so send them where they can act.
		items.push({
			key: 'staff-tools',
			label: 'Staff tools',
			href: resolve('/staff/bands/[id]', { id: input.bandId })
		});
	}

	return items;
}

/** Every band destination, in render order. */
export function bandNavItems(input: BandNavInput): BandNavItem[] {
	return [
		...bandNavTop(input),
		...bandNavSections(input).flatMap((s) => s.items),
		...bandNavFooter(input)
	];
}

export function sectionHasKey(section: BandNavSection, key: BandNavKey | null): boolean {
	return key !== null && section.items.some((i) => i.key === key);
}

/** Which row to light up, detail pages included. See `active-nav.ts`. */
export function activeBandNavKey(input: BandNavInput, pathname: string): BandNavKey | null {
	return activeNavKey(bandNavItems(input), pathname);
}
