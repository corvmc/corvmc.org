import { z } from 'zod';
import { error, redirect } from '@sveltejs/kit';
import { query, form, getRequestEvent } from '$app/server';
import { LONG_TEXT_MAX, SHORT_TEXT_MAX, groupJoinPolicies } from '$lib/config';
import { mapDomainError } from '$lib/server/errors';
import { requireStaff, requireUser } from '$lib/server/authorization';
import { requireGroupRole } from '$lib/server/group/group-context';
import { isFeatureEnabled, requireFeature } from '$lib/server/feature-flags';
import { directoryVisibilities } from '$lib/server/db/schema/directory';
import { getMembers, partitionByStatus } from '$lib/server/band/band-service';
import { listForManager, listPublished } from '$lib/server/group/announcement-service';
import {
	STAFF_GROUP_KINDS,
	assignLeader,
	createGroup,
	deactivate,
	approveApplication,
	declineApplication,
	getGroupDetail,
	joinGroup,
	leaveGroup,
	getPublicGroup,
	getUserGroupStatus,
	listGroups,
	listMemberGroups,
	listPublicGroups,
	reactivate,
	updateGroupSettings
} from '$lib/server/group/group-service';

/**
 * `/staff/groups` — the only place a club or committee comes into existence.
 *
 * Staff-guarded throughout, and flag-gated on `groups`. Bands are deliberately
 * absent from every export here: they are member self-service and have their own
 * staff surface at `/staff/bands`. See docs/specs/groups-spec.md.
 */

async function requireGroupsStaff() {
	await requireFeature('groups');
	return requireStaff();
}

const staffKind = z.enum(STAFF_GROUP_KINDS);

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

const staffGroupFilters = z.object({
	search: z.string().optional(),
	status: z.enum(['active', 'deactivated']).optional(),
	kind: staffKind.optional(),
	page: z.number().int().min(1).optional()
});

export const getStaffGroups = query(staffGroupFilters, async (filters) => {
	await requireGroupsStaff();
	// Never bands. `/staff/bands` is that surface, and the two lists answer
	// different questions: one is a member's own project, the other is a
	// sanctioned CMC program.
	return listGroups(
		{
			search: filters.search || undefined,
			status: filters.status || undefined,
			kinds: filters.kind ? [filters.kind] : STAFF_GROUP_KINDS
		},
		{ page: filters.page ?? 1, pageSize: 50 }
	);
});

/**
 * The staff group detail page's one load-bearing query.
 *
 * The roster comes back partitioned rather than flat: a `by_application` group
 * has applicants, and rendering them mixed into the member list is exactly what
 * `'requested'` exists to prevent.
 */
export const getStaffGroupPage = query(z.string(), async (id) => {
	await requireGroupsStaff();

	const [group, roster] = await Promise.all([getGroupDetail(id), getMembers(id)]);
	if (!group) error(404, 'Group not found');

	return { group, members: partitionByStatus(roster) };
});

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export const createStaffGroup = form(
	z.object({
		kind: staffKind,
		name: z.string().trim().min(1, 'Name is required').max(SHORT_TEXT_MAX),
		bio: z.string().trim().max(LONG_TEXT_MAX).optional().default(''),
		leaderId: z.string().min(1, 'Pick a member to lead this group')
	}),
	async (data) => {
		await requireGroupsStaff();
		try {
			const created = await createGroup({
				kind: data.kind,
				name: data.name,
				bio: data.bio || undefined,
				leaderId: data.leaderId
			});
			return { success: true, id: created.id, slug: created.slug };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

export const updateStaffGroup = form(
	z.object({
		groupId: z.string().min(1),
		joinPolicy: z.enum(groupJoinPolicies),
		joinInstructions: z.string().trim().max(LONG_TEXT_MAX).optional().default(''),
		visibility: z.enum(directoryVisibilities)
	}),
	async (data) => {
		await requireGroupsStaff();
		try {
			await updateGroupSettings(data.groupId, {
				joinPolicy: data.joinPolicy,
				joinInstructions: data.joinInstructions,
				visibility: data.visibility
			});
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

/**
 * Appoint, or re-appoint, the member who runs this program.
 *
 * Distinct from a band's `transferOwner`: that is an owner handing their band
 * on, scoped to their own row. A program leader who has gone quiet cannot be the
 * one to name their replacement, so this needs no participation from whoever
 * holds the seat.
 */
export const assignGroupLeader = form(
	z.object({ groupId: z.string().min(1), userId: z.string().min(1, 'Pick a member') }),
	async (data) => {
		await requireGroupsStaff();
		try {
			await assignLeader(data.groupId, data.userId);
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

export const deactivateGroup = form(z.object({ groupId: z.string().min(1) }), async (data) => {
	await requireGroupsStaff();
	try {
		await deactivate(data.groupId);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

export const reactivateGroup = form(z.object({ groupId: z.string().min(1) }), async (data) => {
	await requireGroupsStaff();
	try {
		await reactivate(data.groupId);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

// ---------------------------------------------------------------------------
// Member — /member/groups
// ---------------------------------------------------------------------------

/**
 * The member index's one load-bearing query: your programs, and the ones you
 * could join, in a single round trip. See `listMemberGroups`.
 */
export const getMemberGroups = query(async () => {
	await requireFeature('groups');
	const user = requireUser();
	return listMemberGroups(user.id);
});

/**
 * The club page's one load-bearing query — the group, your role and the roster
 * together. A club is small by construction, so this is one read rather than a
 * tab's worth each.
 *
 * `allowStaff`, matching every other panel read: staff administer programs, and
 * a page that renders for them with every card failing is the inconsistency
 * phase 4 set out to end.
 */
export const getMemberGroup = query(z.string(), async (slug) => {
	await requireFeature('groups');

	// A non-member — including someone whose application is still `'requested'`,
	// which `requireGroupRole` resolves nothing for — is sent back to the index
	// rather than shown an empty shell or an error boundary. A 404 still 404s:
	// "you cannot see this" and "this does not exist" are different answers and
	// collapsing them would send people to a list for a slug that never existed.
	let ctx;
	try {
		ctx = await requireGroupRole({ slug }, 'member', { allowStaff: true });
	} catch (err) {
		if ((err as { status?: number }).status === 403) redirect(302, '/member/groups');
		throw err;
	}
	const { group, role } = ctx;

	const canManage = role === 'owner' || role === 'admin';

	// One round trip, per docs/checklists/remote-query-fanout.md. Announcements
	// belong here rather than in a query of the tab's own: a club is small by
	// construction, and a per-tab query fanned out of a section component is
	// exactly what that checklist exists to stop.
	//
	// The flag is resolved here too. A tab whose contents 403 is worse than no
	// tab, and the page cannot ask the server itself without a second query.
	const announcementsEnabled = await isFeatureEnabled('announcements');
	const [roster, announcements] = await Promise.all([
		getMembers(group.id).then(partitionByStatus),
		!announcementsEnabled ? [] : canManage ? listForManager(group.id) : listPublished(group.id)
	]);

	return {
		group: {
			id: group.id,
			kind: group.kind,
			name: group.name,
			slug: group.slug,
			bio: group.bio,
			joinPolicy: group.joinPolicy,
			joinInstructions: group.joinInstructions,
			memberCount: group.memberCount
		},
		role,
		canManage,
		announcementsEnabled,
		announcements,
		members: {
			active: roster.active,
			pending: roster.pending,
			// Only an owner or admin answers these, and only a `by_application`
			// group has any. Withheld rather than hidden client-side: a plain
			// member has no business reading who applied.
			requested: canManage ? roster.requested : []
		}
	};
});

// ---------------------------------------------------------------------------
// Member — forms
// ---------------------------------------------------------------------------

/**
 * Join, or apply to join.
 *
 * One form for both doors, because which one it is belongs to the group rather
 * than to the request: the service re-reads `joinPolicy` from the resolved group
 * and the caller cannot say how they should be let in. Guarded by `requireUser`
 * rather than `requireGroupRole` for the obvious reason — someone joining holds
 * no role yet.
 */
export const joinGroupForm = form(z.object({ groupId: z.string().min(1) }), async (data) => {
	await requireFeature('groups');
	const user = requireUser();
	try {
		const { status } = await joinGroup(data.groupId, user.id);
		return { success: true, status };
	} catch (err) {
		mapDomainError(err);
	}
});

/** Leave a program, or withdraw an application to one. Your own row, always. */
export const leaveGroupForm = form(z.object({ groupId: z.string().min(1) }), async (data) => {
	await requireFeature('groups');
	const user = requireUser();
	try {
		await leaveGroup(data.groupId, user.id);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

const applicationSchema = z.object({
	slug: z.string().min(1),
	memberId: z.string().min(1)
});

export const approveApplicationForm = form(applicationSchema, async (data) => {
	await requireFeature('groups');
	// Admin, and the group comes from the ref rather than from the member id:
	// the id is the client's, and an admin's authority stops at their own group.
	const { group } = await requireGroupRole({ slug: data.slug }, 'admin');
	try {
		await approveApplication(data.memberId, group.id);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

export const declineApplicationForm = form(applicationSchema, async (data) => {
	await requireFeature('groups');
	const { group } = await requireGroupRole({ slug: data.slug }, 'admin');
	try {
		await declineApplication(data.memberId, group.id);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

// ---------------------------------------------------------------------------
// Public — /groups
// ---------------------------------------------------------------------------

/**
 * The public group directory.
 *
 * No guard beyond the feature flag, deliberately: these are the programs the
 * Collective is advertising, and `visibility = 'public'` is the whole of the
 * decision — made per group by staff, not inferred here. A signed-out visitor
 * and a member see the same list.
 */
export const getPublicGroups = query(async () => {
	await requireFeature('groups');
	return listPublicGroups();
});

/**
 * The public page's one load-bearing query: the group, and whether the person
 * looking at it can act.
 *
 * `viewerStatus` is what decides between a Join button, a "you already belong"
 * note and a sign-in prompt, and it is computed here because the client cannot
 * be trusted to. It is null for a signed-out visitor, which is not an error —
 * the Join button becomes a sign-in prompt that returns them here.
 */
export const getPublicGroupPage = query(z.string(), async (slug) => {
	await requireFeature('groups');

	const group = await getPublicGroup(slug);
	if (!group) error(404, 'Group not found');

	const { locals } = getRequestEvent();
	const viewerStatus = locals.user ? await getUserGroupStatus(group.id, locals.user.id) : null;

	return { group, signedIn: !!locals.user, viewerStatus };
});
