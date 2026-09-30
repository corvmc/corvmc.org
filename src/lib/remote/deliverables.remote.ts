import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { query } from '$app/server';
import { form } from './_remote';
import { mapDomainError } from '$lib/server/errors';
import {
	committeeCarries,
	requireCommitteeMember,
	requireGroupRole,
	requireProjectCommittee
} from '$lib/server/group/group-context';
import { can } from '$lib/server/authorization';
import { listCommittees } from '$lib/server/project/project-service';
import {
	getDeliverableOwner,
	getTaskWorkOrderId,
	listCommitteeOpenItems,
	reassignDeliverable,
	DeliverableNotFoundError
} from '$lib/server/volunteer/deliverables-service';
import { claimShift } from '$lib/server/volunteer/volunteer-signup-service';
import { resolveWorkOrder } from '$lib/server/volunteer/work-order-service';
import { setWorkTaskDone } from '$lib/server/volunteer/duty-list-service';
import { getStaffEventProduction } from './events.remote';

/**
 * A committee's deliverables (docs/specs/shipped/committee-deliverables-spec.md §4, §6).
 *
 * Every write reads the owning committee off the work order, never off the
 * request, and passes it to `requireCommitteeMember` with
 * `volunteer.manageShifts`: an active member of the owner whose grants carry it,
 * or a holder of it outright (staff). Owning an item grants nothing else.
 */

const MANAGE = 'volunteer.manageShifts' as const;

/** The owner of an item, or 404 — before any guard, so a missing id is not a 403 oracle. */
async function ownerOf(workOrderId: string) {
	const owner = await getDeliverableOwner(workOrderId);
	if (!owner) error(404, 'That item is not open any more');
	return owner;
}

/** Refresh whichever surface the form came from. Neither id is read for authorisation. */
function refreshFrom(data: { slug?: string; eventId?: string }) {
	if (data.slug) void getCommitteeOpenItems(data.slug).refresh();
	if (data.eventId) void getStaffEventProduction(data.eventId).refresh();
}

const from = { slug: z.string().optional(), eventId: z.string().optional() };

/** The Open items tab: every open or overdue item the committee owns, across shows. */
export const getCommitteeOpenItems = query(z.string().min(1), async (slug) => {
	const ctx = await requireGroupRole({ slug }, 'member', { allowStaff: true });
	if (ctx.group.kind !== 'committee') error(404, 'Group not found');

	const [items, committees] = await Promise.all([
		listCommitteeOpenItems(ctx.group.id),
		listCommittees()
	]);
	const canKeep = ctx.role === 'staff' ? await can(MANAGE) : committeeCarries(ctx.group, MANAGE);
	return {
		items,
		canKeep,
		viewerId: ctx.user.id,
		committees: committees.filter((c) => c.id !== ctx.group.id)
	};
});

/** Take it: the caller claims the item, confirmed, because their committee is the coordinator. */
export const takeDeliverable = form(z.object({ id: z.string().min(1), ...from }), async (data) => {
	const { groupId } = await ownerOf(data.id);
	const { user } = await requireCommitteeMember(groupId, MANAGE);
	try {
		await claimShift(data.id, user.id, { assignedByStaff: true });
	} catch (err) {
		mapDomainError(err);
	}
	refreshFrom(data);
	return { success: true };
});

/** Done anyway: the hand override, whatever the item's condition says. */
export const resolveDeliverable = form(
	z.object({ id: z.string().min(1), ...from }),
	async (data) => {
		const { groupId } = await ownerOf(data.id);
		const { user } = await requireCommitteeMember(groupId, MANAGE);
		try {
			await resolveWorkOrder(data.id, { resolvedByUserId: user.id });
		} catch (err) {
			mapDomainError(err);
		}
		refreshFrom(data);
		return { success: true };
	}
);

export const tickDeliverableTask = form(
	z.object({
		taskId: z.string().min(1),
		// An unchecked box is not submitted, so absence reads as false.
		done: z.boolean().optional().default(false),
		...from
	}),
	async (data) => {
		const workOrderId = await getTaskWorkOrderId(data.taskId);
		if (!workOrderId) error(404, 'Task not found');
		const { groupId } = await ownerOf(workOrderId);
		const { user } = await requireCommitteeMember(groupId, MANAGE);
		try {
			await setWorkTaskDone(data.taskId, data.done, user.id);
		} catch (err) {
			mapDomainError(err);
		}
		refreshFrom(data);
		return { success: true };
	}
);

/**
 * Hand an item to another committee, or back to staff. The owner may, and so
 * may anyone who keeps work orders on the show's project, which is how the
 * console's card reaches it.
 */
export const reassignDeliverableForm = form(
	z.object({ id: z.string().min(1), groupId: z.string().optional(), ...from }),
	async (data) => {
		const owner = await ownerOf(data.id);
		try {
			await requireCommitteeMember(owner.groupId, MANAGE);
		} catch (err) {
			if ((err as { status?: number }).status !== 403 || !owner.projectId) throw err;
			await requireProjectCommittee(owner.projectId, MANAGE);
		}
		try {
			await reassignDeliverable(data.id, data.groupId || null);
		} catch (err) {
			if (err instanceof DeliverableNotFoundError) error(404, err.message);
			mapDomainError(err);
		}
		refreshFrom(data);
		return { success: true };
	}
);
