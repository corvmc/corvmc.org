import { z } from 'zod';
import { error, invalid, redirect } from '@sveltejs/kit';
import { query, form, getRequestEvent } from '$app/server';
import { LONG_TEXT_MAX, SHORT_TEXT_MAX, groupJoinPolicies } from '$lib/config';
import { mapDomainError } from '$lib/server/errors';
import { requireStaff, requireUser } from '$lib/server/authorization';
import { requireGroupRole, requireProgramRole } from '$lib/server/group/group-context';
import { directoryVisibilities } from '$lib/server/db/schema/directory';
import {
	acceptInvitation,
	declineInvitation,
	getMembers,
	invite,
	partitionByStatus,
	removeMember as removeMemberService,
	revokeInvitation as revokeInvitationService,
	searchMembers as searchMembersService,
	transferOwnership as transferOwnershipService,
	updateMember,
	BandMemberExistsError
} from '$lib/server/band/band-service';
import {
	createInvite as createEmailInvite,
	listForGroup as listEmailInvites,
	revoke as revokeEmailInviteService
} from '$lib/server/group/group-invite-service';
import { resolveImageUrl } from '$lib/server/storage';
import {
	getMuteState,
	listForManager,
	listPublished
} from '$lib/server/group/announcement-service';
import { listGroupSessions } from '$lib/server/event/event-service';
import { listProjects } from '$lib/server/project/project-service';
import { list as listFiles, getUsage as getDocumentUsage } from '$lib/server/group/file-service';
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
	updateGroupProfile,
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

	// One round trip, per the custom/no-concurrent-remote-queries rule. Announcements
	// belong here rather than in a query of the tab's own: a club is small by
	// construction, and a per-tab query fanned out of a section component is
	// exactly what that checklist exists to stop.
	const [
		roster,
		announcements,
		notifyAnnouncements,
		sessions,
		files,
		documentUsage,
		projects,
		emailInvites
	] = await Promise.all([
		getMembers(group.id).then(partitionByStatus),
		canManage ? listForManager(group.id) : listPublished(group.id),
		// Null for a staff non-member — no roster row, so nothing to mute.
		getMuteState(group.id, ctx.user.id),
		listGroupSessions(group.id),
		listFiles(group.id),
		// Its own statement rather than a sum over `files`: that list is capped,
		// and it carries the quota constants the meter renders, which a
		// component cannot import from a server module.
		getDocumentUsage(group.id),
		// A committee's own work, read through the same guard as everything else
		// on this page. Only committees own projects, so a club gets an empty
		// list and never shows the tab.
		group.kind === 'committee' ? listProjects({ groupId: group.id }) : Promise.resolve([]),
		// Invitations to an address rather than to an account. Withheld from a
		// plain member for the same reason `requested` is: who was asked is a
		// manager's business.
		canManage ? listEmailInvites(group.id) : Promise.resolve([])
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
		announcements,
		notifyAnnouncements,
		files,
		documentUsage,
		sessions: sessions.map((e) => ({
			id: e.id,
			title: e.title,
			// The edit form needs to open pre-filled, so it needs what it edits.
			description: e.description,
			startsAt: e.startsAt,
			endsAt: e.endsAt,
			status: e.status,
			// Whether this one holds the room, which is the fact that distinguishes
			// a program's session from a listing it merely advertises. A cancelled
			// session keeps the pointer — the reservation is cancelled beside it,
			// not unlinked — so the status has to be part of the answer.
			reservesRoom: !!e.reservationId && e.status !== 'cancelled'
		})),
		// Name, status and dates only. A committee member reads what their group is
		// working on; the budget and what it has burned are a staff question, and
		// `/staff/projects` is where that is answered.
		projects: projects.map((project) => ({
			id: project.id,
			name: project.name,
			status: project.status,
			startsAt: project.startsAt,
			endsAt: project.endsAt
		})),
		emailInvites,
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
	const { group } = await requireGroupRole({ slug: data.slug }, 'admin');
	try {
		await declineApplication(data.memberId, group.id);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

// ---------------------------------------------------------------------------
// Member — the roster a leader runs
// ---------------------------------------------------------------------------
//
// The writes underneath are `band-service`'s and were already kind-agnostic —
// phase 4 generalised them. What was missing was a group-facing name and a
// surface, which is why these are thin. `requireProgramRole` throughout: a band
// has `/band/{slug}/members` and must not resolve here.

const rosterRef = z.object({ slug: z.string().min(1) });
const memberRef = rosterRef.extend({ memberId: z.string().min(1) });

/** Candidates for the invite picker. Non-members of this group only. */
export const searchGroupUsers = query(
	z.object({ slug: z.string().min(1), q: z.string() }),
	async ({ slug, q }) => {
		const { group } = await requireProgramRole({ slug }, 'admin');
		if (q.length < 2) return [];
		return searchMembersService(q, group.id);
	}
);

export const inviteGroupMember = form(
	memberRef.omit({ memberId: true }).extend({
		userId: z.string().min(1, 'Pick someone to invite'),
		role: z.enum(['admin', 'member']),
		position: z.string().max(100).optional().default('')
	}),
	async (data) => {
		const { user, group } = await requireProgramRole({ slug: data.slug }, 'admin');
		try {
			const member = await invite(group.id, data.userId, data.role, data.position || null, user.id);
			return { success: true, memberId: member.id };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

export const inviteGroupByEmail = form(
	rosterRef.extend({
		email: z.string().email('Valid email required'),
		role: z.enum(['admin', 'member']),
		position: z.string().max(100).optional().default('')
	}),
	async (data, issue) => {
		const { user, group } = await requireProgramRole({ slug: data.slug }, 'admin');
		try {
			const result = await createEmailInvite(
				data.email,
				group.id,
				data.role,
				data.position || null,
				user.id
			);
			return { success: true, ...result };
		} catch (err) {
			// Already on the roster / already invited is an ordinary state. Thrown,
			// it reaches Sentry as a 500 and shows a generic toast — see
			// JAVASCRIPT-SVELTEKIT-2D on the band side.
			if (err instanceof BandMemberExistsError) invalid(issue.email(err.message));
			throw err;
		}
	}
);

export const revokeGroupInvitation = form(memberRef, async (data) => {
	// Scoped to the resolved group: the member id is the client's, and a
	// leader's authority stops at their own roster.
	const { group } = await requireProgramRole({ slug: data.slug }, 'admin');
	try {
		await revokeInvitationService(data.memberId, group.id);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

export const revokeGroupEmailInvite = form(
	rosterRef.extend({ inviteId: z.string().min(1) }),
	async (data) => {
		const { group } = await requireProgramRole({ slug: data.slug }, 'admin');
		try {
			await revokeEmailInviteService(data.inviteId, group.id);
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

export const removeGroupMember = form(memberRef, async (data) => {
	const { group } = await requireProgramRole({ slug: data.slug }, 'admin');
	try {
		await removeMemberService(data.memberId, group.id);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

/**
 * A leader editing somebody else's row: their role, and the group's word for
 * what they do.
 *
 * No `alias`, matching `updateMemberRemote`: a stage name is
 * self-identification, and a leader cannot rename someone.
 */
export const updateGroupMember = form(
	memberRef.extend({
		role: z.enum(['admin', 'member']).optional(),
		position: z.string().max(100).optional()
	}),
	async (data) => {
		const { group } = await requireProgramRole({ slug: data.slug }, 'admin');
		try {
			await updateMember(
				data.memberId,
				{
					role: data.role,
					position: data.position !== undefined ? data.position || null : undefined
				},
				group.id
			);
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

/**
 * A leader handing the program on, scoped to their own seat.
 *
 * Distinct from `assignGroupLeader`, which is staff appointing over the head of
 * whoever holds it. `owner`, because only the outgoing owner can do this.
 */
export const transferGroupOwner = form(
	rosterRef.extend({ newOwnerId: z.string().min(1) }),
	async (data) => {
		const { user, group } = await requireProgramRole({ slug: data.slug }, 'owner');
		try {
			await transferOwnershipService(group.id, data.newOwnerId, user.id);
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

/**
 * Answering an invitation to a program.
 *
 * `requireUser`, not `requireGroupRole`: the caller's row is `pending`, which
 * resolves no role. The group comes from the id and the service scopes the
 * write to `(groupId, userId)`, so naming someone else's group finds nothing.
 *
 * Both outcomes come back in-band. A revoked or already-answered invitation is
 * an ordinary state, and throwing would report it as a 500.
 */
export const acceptGroupInvite = form(z.object({ groupId: z.string().min(1) }), async (data) => {
	const user = requireUser();
	const result = await acceptInvitation(data.groupId, user.id);
	return result.status === 'not_found'
		? { success: false as const, reason: 'not_found' as const }
		: { success: true as const };
});

export const declineGroupInvite = form(z.object({ groupId: z.string().min(1) }), async (data) => {
	const user = requireUser();
	const declined = await declineInvitation(data.groupId, user.id);
	return declined
		? { success: true as const }
		: { success: false as const, reason: 'not_found' as const };
});

// ---------------------------------------------------------------------------
// Member — /member/groups/{slug}/edit
// ---------------------------------------------------------------------------

/**
 * The leader's editor: what a program's own owner or admin may change.
 *
 * `joinPolicy` and `visibility` come back read-only. They decide who may walk
 * in and whether the program is advertised, and the spec's argument for free
 * room time is that staff alone settle both — so they render as facts with a
 * pointer at staff, not as fields. See `updateGroupProfile`.
 */
// `requireProgramRole`, so a band slug 404s here: a band edits at
// `/band/{slug}/edit`, which carries a listing this form deliberately omits.
export const getGroupEditor = query(z.string(), async (slug) => {
	const { group } = await requireProgramRole({ slug }, 'admin', { allowStaff: true });

	return {
		id: group.id,
		kind: group.kind,
		name: group.name,
		slug: group.slug,
		bio: group.bio,
		joinInstructions: group.joinInstructions,
		avatarUrl: resolveImageUrl(group.avatarKey),
		// Read-only, and named so the page can say who to ask.
		joinPolicy: group.joinPolicy
	};
});

export const updateGroupProfileForm = form(
	z.object({
		slug: z.string().min(1),
		name: z.string().trim().min(1, 'Name is required').max(SHORT_TEXT_MAX),
		bio: z.string().max(LONG_TEXT_MAX).optional().default(''),
		joinInstructions: z.string().trim().max(LONG_TEXT_MAX).optional().default('')
	}),
	async (data) => {
		// Admin and no `allowStaff`: a write, and staff have `/staff/groups`.
		const { group } = await requireProgramRole({ slug: data.slug }, 'admin');
		try {
			await updateGroupProfile(group.id, {
				name: data.name,
				bio: data.bio,
				joinInstructions: data.joinInstructions
			});
			// Renaming does not move the slug, so both queries stay keyed on it.
			void getGroupEditor(data.slug).refresh();
			void getMemberGroup(data.slug).refresh();
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

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
	const group = await getPublicGroup(slug);
	if (!group) error(404, 'Group not found');

	const { locals } = getRequestEvent();
	const viewerStatus = locals.user ? await getUserGroupStatus(group.id, locals.user.id) : null;

	return { group, signedIn: !!locals.user, viewerStatus };
});
