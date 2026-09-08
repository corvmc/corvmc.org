import { z } from 'zod';
import { query, form } from '$app/server';
import { requireCapability } from '$lib/server/authorization';
import { mapDomainError } from '$lib/server/errors';
import { ORIENTATION_WAIVED_REASON_MAX } from '$lib/config';
import {
	getOrientation,
	waiveOrientation as waiveService
} from '$lib/server/volunteer/orientation-service';

/**
 * Whether a member has been shown around the space.
 *
 * Staff-only. It is informational — nothing anywhere is gated on it — but the
 * desk needs to know before somebody turns up, and `reservation.manage` is the
 * right guard because this is a fact about the room rather than about
 * volunteering.
 */
export const getMemberOrientation = query(z.string(), async (userId) => {
	await requireCapability('reservation.manage');

	const row = await getOrientation(userId);
	if (!row) return { state: 'pending' as const, scheduledFor: null, detail: null };

	return {
		state: row.state,
		scheduledFor: row.scheduledFor,
		detail: {
			completedAt: row.completedAt,
			completedByUserId: row.completedByUserId,
			waivedAt: row.waivedAt,
			waivedReason: row.waivedReason,
			reservationId: row.reservationId,
			workOrderId: row.workOrderId
		}
	};
});

/**
 * Staff say this member does not need showing around.
 *
 * A reason is required: the next staffer reading the list needs to know why
 * somebody is not on it.
 */
export const waiveMemberOrientation = form(
	z.object({
		userId: z.string().min(1),
		reason: z.string().trim().min(1, 'Say why it is not needed').max(ORIENTATION_WAIVED_REASON_MAX)
	}),
	async (data) => {
		const staff = await requireCapability('reservation.manage');

		try {
			await waiveService(data.userId, { waivedByUserId: staff.id, reason: data.reason });
		} catch (err) {
			mapDomainError(err);
		}

		await getMemberOrientation(data.userId).refresh();
		return { success: true };
	}
);
