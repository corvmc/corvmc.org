import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { query, form } from '$app/server';
import { LONG_TEXT_MAX, SHORT_TEXT_MAX, groupJoinPolicies } from '$lib/config';
import { mapDomainError } from '$lib/server/errors';
import { requireStaff } from '$lib/server/authorization';
import { requireFeature } from '$lib/server/feature-flags';
import { directoryVisibilities } from '$lib/server/db/schema/directory';
import { getMembers, partitionByStatus } from '$lib/server/band/band-service';
import {
	STAFF_GROUP_KINDS,
	assignLeader,
	createGroup,
	deactivate,
	getGroupDetail,
	listGroups,
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
