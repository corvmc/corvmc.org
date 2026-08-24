import { z } from 'zod';
import { error, redirect } from '@sveltejs/kit';
import { query, getRequestEvent } from '$app/server';
import { listForUser, getBySlug, getUserRole } from '$lib/server/band/band-service';
import { resolveBandSlug } from '$lib/server/band/band-address-service';
import { hasAnyRole } from '$lib/server/authorization';
import { getAllFeatureFlags } from '$lib/server/feature-flags';
import { getUnresolvedCount } from '$lib/server/inbox/thread-service';
import { countPortalUnread } from '$lib/server/inbox/portal-service';
import { countDirectUnread, countPendingRequests } from '$lib/server/inbox/direct-service';
import { getStatusCounts as getVolunteerStatusCounts } from '$lib/server/volunteer/hour-log-service';
import { countPendingSubmissions } from '$lib/server/event/community-event-service';
import {
	countAwaitingModeration,
	countAwaitingResponse,
	countPendingEdits
} from '$lib/server/suggestion/suggestion-service';
import { resolveImageUrl } from '$lib/server/storage';
import { captureException } from '$lib/server/sentry';

export const getMe = query(async () => {
	try {
		const { locals } = getRequestEvent();
		if (!locals.user) return null;
		return {
			id: locals.user.id,
			name: locals.user.name,
			email: locals.user.email,
			image: resolveImageUrl(locals.user.image)
		};
	} catch (err) {
		captureException(err);
		return null;
	}
});

/**
 * `listForUser` returns pending invitations alongside active memberships, and
 * `getUserRole` only recognises 'active'. Mapping the raw list into the nav put
 * not-yet-accepted bands in the sidebar and panel switcher as live links; a
 * click then hit the 403 below and rendered a blank page
 * (JAVASCRIPT-SVELTEKIT-3). Invitations belong on /member/bands, which buckets
 * them separately — the nav lists bands you are actually in.
 */
function activeOnly<T extends { status: string }>(bands: T[]): T[] {
	return bands.filter((b) => b.status === 'active');
}

export const getMemberLayout = query(async () => {
	const { locals } = getRequestEvent();
	if (!locals.user) throw redirect(302, '/login');
	const user = locals.user;

	const [userBands, isStaff, features, portalUnread, directUnread, pendingRequests] =
		await Promise.all([
			listForUser(user.id).catch(() => []),
			hasAnyRole(user.id, ['admin', 'staff']),
			getAllFeatureFlags(),
			countPortalUnread(user.id).catch(() => 0),
			countDirectUnread(user.id).catch(() => 0),
			countPendingRequests(user.id).catch(() => 0)
		]);

	// Requests are deliberately absent from the badge. They show up in the
	// Messages list marked as requests, so a member finds them when they go
	// looking — but an unconsented message should not follow anyone around the
	// site. `pendingRequests` is surfaced separately for the label on the list.
	const messagesUnread = portalUnread + directUnread;

	return {
		user: { id: user.id, name: user.name, email: user.email },
		userBands: activeOnly(userBands).map((b) => ({
			id: b.id,
			name: b.name,
			slug: b.slug,
			avatarUrl: resolveImageUrl(b.avatarKey),
			role: b.role
		})),
		isStaff,
		features,
		messagesUnread,
		pendingRequests
	};
});

export const getStaffLayout = query(async () => {
	const { locals } = getRequestEvent();
	if (!locals.user) throw redirect(302, '/login');

	const allowed = await hasAnyRole(locals.user.id, ['admin', 'staff']);
	if (!allowed) throw redirect(302, '/');

	// The staff panel deliberately ignores feature flags — flags gate the
	// member/band/public surfaces only, so staff can administer a feature
	// before (and after) it is switched on for everyone else.
	const user = locals.user;
	const [userBands, inboxUnread, volunteerPending, listingsPending, suggestionsAwaiting] =
		await Promise.all([
			listForUser(user.id).catch(() => []),
			getUnresolvedCount().catch(() => 0),
			getVolunteerStatusCounts()
				.then((c) => c.pending)
				.catch(() => 0),
			countPendingSubmissions().catch(() => 0),
			// Moderation leads the badge: everything in that bucket is invisible to
			// members while it waits, which is the cost of hiding on a single report.
			Promise.all([countAwaitingModeration(), countAwaitingResponse(), countPendingEdits()])
				.then(([m, r, e]) => m + r + e)
				.catch(() => 0)
		]);

	return {
		user: { id: user.id, name: user.name, email: user.email },
		userBands: activeOnly(userBands).map((b) => ({ id: b.id, name: b.name, slug: b.slug })),
		inboxUnread,
		volunteerPending,
		// Nothing renders this yet — the staff sidebar has no listings row. Either
		// wire it to a Moderation badge or drop it along with the query above.
		listingsPending,
		suggestionsAwaiting
	};
});

/**
 * Move a dashboard path onto the band's new slug, keeping the subpage.
 *
 * `url.pathname` inside a remote function is the *page* path, which SvelteKit
 * rebuilds from the client-supplied `x-sveltekit-pathname` header — untrusted
 * input. Only rewrite when it has the shape we expect; the prefix check is what
 * stops a crafted header turning this into an open redirect.
 */
function dashboardPathAfterRename(oldSlug: string, newSlug: string): string {
	const { url } = getRequestEvent();
	const prefix = `/band/${oldSlug}`;
	if (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) {
		return `/band/${newSlug}${url.pathname.slice(prefix.length)}${url.search}`;
	}
	return `/band/${newSlug}`;
}

export const getBandLayout = query(z.string(), async (slug) => {
	const { locals } = getRequestEvent();
	if (!locals.user) throw redirect(302, '/login');

	const band = await getBySlug(slug);
	if (!band) {
		// The owner may have changed the band's address out from under a bookmark.
		// This lives here rather than in `requireBandBySlug` on purpose: that guard
		// runs on mutations, where a thrown redirect is applied as a client
		// navigation and would silently discard the submitted form. A stale slug
		// should fail loudly on write and forward on read — and this query runs
		// first, so the browser is on the new address before any form can post.
		const moved = await resolveBandSlug(slug);
		if (moved?.kind === 'moved' && moved.slug !== slug) {
			redirect(302, dashboardPathAfterRename(slug, moved.slug));
		}
		throw error(404, 'Band not found');
	}

	const [role, isStaff, userBands, features] = await Promise.all([
		getUserRole(band.id, locals.user.id),
		hasAnyRole(locals.user.id, ['admin', 'staff']),
		listForUser(locals.user.id).catch(() => []),
		getAllFeatureFlags()
	]);

	if (!role && !isStaff) {
		throw error(403, 'You are not a member of this band');
	}

	return {
		band: { ...band, avatarUrl: resolveImageUrl(band.avatarKey) },
		userRole: role ?? 'staff',
		isStaff,
		userBands: activeOnly(userBands).map((b) => ({ id: b.id, name: b.name, slug: b.slug })),
		user: { id: locals.user.id, name: locals.user.name, email: locals.user.email },
		features
	};
});
