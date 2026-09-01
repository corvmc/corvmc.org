import { query, form } from '$app/server';
import { z } from 'zod';
import { getRequestEvent } from '$app/server';
import { requireStaff, requireStaffOrOwner } from '$lib/server/authorization';
import { mapDomainError } from '$lib/server/errors';
import * as instructorService from '$lib/server/instructor/instructor-service';
import { INSTRUCTOR_REVIEW_NOTES_MAX } from '$lib/config';

// NOTE: a `.remote.ts` module may export **only** remote functions — SvelteKit
// refuses to initialise the file otherwise, at import time rather than at type
// check. So shared schemas live in `$lib/server/db/schema/instructor.ts` and are
// imported by whoever needs them, never re-exported through here.

/**
 * The staff half of the instructor module — reviewing applications and granting,
 * pausing or ending teaching status.
 *
 * Every export guards with `requireStaff()` first. There is no member half here
 * yet: applying, editing a listing and withdrawing arrive with the public
 * listing, because a member-facing surface must not land before the thing it
 * advertises works. Until then the module runs staff-curated, which is a real
 * operating mode rather than a gap.
 */

export const getStaffInstructors = query(async () => {
	await requireStaff();
	return instructorService.listForStaff();
});

/**
 * One member's instructor record, for the staff user page. Returns null when
 * they have none, which is the ordinary case and not an error.
 *
 * `requireStaffOrOwner` rather than `requireStaff`: a member may read their own
 * record — they will need to, once the profile card lands — and the guard
 * already expresses exactly that.
 */
export const getUserInstructor = query(z.string().min(1), async (userId) => {
	await requireStaffOrOwner(getRequestEvent().locals.user?.id, userId);
	return instructorService.getByUserId(userId);
});

const idSchema = z.object({ id: z.string().min(1) });

/**
 * A note the member will read, on `sendBack`; a note only staff read, on the two
 * that end a grant. Both are required, and for the same reason from opposite
 * directions: the applicant cannot fix what they cannot see, and the next
 * staffer down the list cannot tell why somebody is off it.
 */
const noteSchema = idSchema.extend({
	note: z.string().trim().min(1, 'Say why').max(INSTRUCTOR_REVIEW_NOTES_MAX)
});

export const approveInstructor = form(idSchema, async (data) => {
	const staff = await requireStaff();
	try {
		await instructorService.approve(data.id, staff.id);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

export const sendBackInstructor = form(noteSchema, async (data) => {
	const staff = await requireStaff();
	try {
		await instructorService.sendBack(data.id, staff.id, data.note);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

/**
 * Grant directly, with no application — the staffer already knows this person.
 * Also the way back from `paused` or `retired`, because reinstating and granting
 * are the same decision made twice.
 */
export const grantInstructor = form(
	z.object({ userId: z.string().min(1, 'Pick a member') }),
	async (data) => {
		const staff = await requireStaff();
		try {
			await instructorService.grant(data.userId, staff.id);
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

export const pauseInstructor = form(noteSchema, async (data) => {
	const staff = await requireStaff();
	try {
		await instructorService.pause(data.id, staff.id, data.note);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

export const retireInstructor = form(noteSchema, async (data) => {
	const staff = await requireStaff();
	try {
		await instructorService.retire(data.id, staff.id, data.note);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});
