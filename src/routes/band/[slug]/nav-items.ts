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
 *
 * **Two zones**, the shape the member panel uses. `bandNavMain` is what the
 * band does; `bandNavFooter` is what it administers — billing, settings, and
 * the staff escape hatch — which a spacer pins to the foot of the sidebar.
 * Administering the band is *about* it rather than *in* it, and those rows
 * were sitting at the end of a sixteen-row list where the useful ones are.
 */
import { resolve } from '$app/paths';
import { activeNavKey, type NavNode } from '$lib/components/layout/Nav/active-nav';

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
}

/** The rows above the spacer — what the band does. */
export function bandNavMain(input: BandNavInput): BandNavItem[] {
	const slug = input.slug;
	const isOwner = input.userRole === 'owner';
	const isOwnerOrAdmin = isOwner || input.userRole === 'admin';
	const premium = input.tier === 'premium';

	const items: BandNavItem[] = [
		// Deliberately not `exact`, unlike the member panel's. A band row can be
		// hidden by role, and a viewer on a page whose row they cannot see should
		// land on the panel root rather than on nothing — `nav-items.spec.ts`
		// pins that. #1237 is about rows that exist for nobody, which is a
		// different situation and only the member panel has it.
		{ key: 'dashboard', label: 'Dashboard', href: resolve('/band/[slug]', { slug }) }
	];

	items.push({ key: 'members', label: 'Members', href: resolve('/band/[slug]/members', { slug }) });

	// Every member reads announcements; only owner and admin post, which the page
	// itself gates. It sat behind an `announcements` flag until the module was
	// launched — a member who cannot see the entry cannot read what the band told
	// them, which is backwards, so no role is gated here.
	items.push({
		key: 'announcements',
		label: 'Announcements',
		href: resolve('/band/[slug]/announcements', { slug })
	});

	// Reservations used to sit behind a `bandReservations` flag, retired on main
	// in #238's wake — band booking is simply on now.
	items.push({
		key: 'reservations',
		label: 'Reservations',
		href: resolve('/band/[slug]/reservations', { slug })
	});
	items.push({ key: 'events', label: 'Events', href: resolve('/band/[slug]/events', { slug }) });

	// Every member sees the discography; only owner and admin can change it, and
	// the page decides that from its own `canManage`. Flagged because the
	// storefront's launch is a Stripe decision rather than a build one — the same
	// ground `bandPremium` is held on.
	if (input.features.bandAudio) {
		items.push({ key: 'music', label: 'Releases', href: resolve('/band/[slug]/music', { slug }) });
		// Banking setup, so owner-or-admin rather than every member — the same
		// ground Settings is on, and narrower than Music above it.
		if (isOwnerOrAdmin) {
			items.push({
				key: 'payouts',
				label: 'Payouts',
				href: resolve('/band/[slug]/music/payouts', { slug })
			});
		}
	}
	// Every role, staff included. The rider is the one panel page that is not
	// owner/admin gated: the person who knows what their amp needs is the person
	// who owns the amp, and a member who cannot reach the page cannot answer for
	// their own corner of it. Writes are still split — a member's save only ever
	// touches their own rows.
	items.push({ key: 'rider', label: 'Tech rider', href: resolve('/band/[slug]/rider', { slug }) });
	// Beside the rider and on the same footing, for the same reason — and because
	// this is the easier of the two doors: a band can say what it packs on the day
	// it forms, which is not true of what a desk has to find.
	items.push({
		key: 'packing',
		label: 'Packing list',
		href: resolve('/band/[slug]/packing', { slug })
	});

	if (isOwnerOrAdmin) {
		items.push({
			key: 'edit',
			label: 'Edit Profile',
			href: resolve('/band/[slug]/edit', { slug })
		});
		// Deliberately not premium-gated, and deliberately not folded into Edit
		// Profile. A press kit is free for every act, and its two halves answer
		// to different readers: the profile is what the public sees, this is what
		// a venue is sent. One page per audience is what keeps a phone number
		// from drifting onto the wrong one.
		items.push({
			key: 'press-kit',
			label: 'Press Kit',
			href: resolve('/band/[slug]/press-kit', { slug })
		});
	}

	if (premium && isOwnerOrAdmin) {
		// No View Live Site row beside it: the editor's own header already
		// carries that link, and it is the only place that can — the band's
		// custom domain is resolved there, not here.
		items.push({
			key: 'page-editor',
			label: 'Page Editor',
			href: resolve('/band/[slug]/page-editor', { slug })
		});
	}

	return items;
}

/**
 * The rows a spacer pins to the foot — administering the band rather than
 * running it. Can be empty: a plain member administers nothing, and the
 * spacer simply reaches the bottom.
 */
export function bandNavFooter(input: BandNavInput): BandNavItem[] {
	const slug = input.slug;
	const isOwner = input.userRole === 'owner';
	const isOwnerOrAdmin = isOwner || input.userRole === 'admin';
	const items: BandNavItem[] = [];

	if (isOwnerOrAdmin) {
		// Billing is genuinely owner-only — `upgradeToPremium` and friends are
		// `requireBandOwner` — so unlike Settings this one stays keyed on owner.
		if (isOwner) {
			items.push({
				key: 'subscription',
				label: 'Subscription',
				href: resolve('/band/[slug]/subscription', { slug })
			});
		}
		// Admins get Settings: the page shows them the band's address read-only,
		// which is the thing they could not reach at all before.
		items.push({
			key: 'settings',
			label: 'Settings',
			href: resolve('/band/[slug]/settings', { slug })
		});
	} else if (input.isStaff) {
		// A staff non-member resolves to the pseudo-role 'staff'. Every control on
		// the settings page is owner-guarded, so send them where they can act.
		items.push({
			key: 'staff-tools',
			label: 'Staff tools',
			href: resolve('/staff/bands/[id]', { id: input.bandId })
		});
	}

	return items;
}

/**
 * Destinations the app chrome owns. Never rendered in the sidebar; here so
 * they still resolve.
 *
 * The topbar's messages icon points at the panel you are standing in, so in a
 * band panel it already opens that band's inbox — a second copy in the
 * sidebar was the same link twice. The member panel drew the same conclusion
 * first; this follows it.
 *
 * The badge goes with the row, and it is not the same number: the topbar's is
 * `countUnifiedUnread` across every inbox the viewer can read, so it says
 * "you have mail somewhere" where the sidebar's said "in this band". That is
 * the trade the member panel already took, and the icon still lands in the
 * right inbox.
 */
export function bandNavChrome(input: BandNavInput): BandNavItem[] {
	return [
		{
			key: 'messages',
			label: 'Messages',
			href: resolve('/band/[slug]/messages', { slug: input.slug })
		}
	];
}

/** Every band destination, sidebar and chrome alike. Not a render list. */
export function bandNavItems(input: BandNavInput): BandNavItem[] {
	return [...bandNavMain(input), ...bandNavFooter(input), ...bandNavChrome(input)];
}

/**
 * Which row to light up. Band detail pages — `/band/x/events/<id>` and the EPK
 * editor under `/band/x/page-editor` — lit nothing before this, because
 * `NavItem` matches the pathname exactly on its own.
 */
export function activeBandNavKey(input: BandNavInput, pathname: string): BandNavKey | null {
	return activeNavKey(bandNavItems(input), pathname);
}
