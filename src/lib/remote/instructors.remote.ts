import { query, form } from '$app/server';
import { z } from 'zod';
import { getRequestEvent } from '$app/server';
import { requireStaff, requireStaffOrOwner, requireUser } from '$lib/server/authorization';
import { mapDomainError } from '$lib/server/errors';
import * as instructorService from '$lib/server/instructor/instructor-service';
import {
	INSTRUCTOR_REVIEW_NOTES_MAX,
	INSTRUCTOR_HEADLINE_MAX,
	INSTRUCTOR_BLURB_MAX,
	INSTRUCTOR_RATES_NOTE_MAX,
	INSTRUCTOR_APPLICATION_NOTE_MAX
} from '$lib/config';
import {
	listInstructors,
	publicContactStatus,
	type InstructorFilters
} from '$lib/server/instructor/instructor-directory-service';

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

// ---------------------------------------------------------------------------
// The member half
// ---------------------------------------------------------------------------

/**
 * The listing fields a member controls — and, before approval, the application
 * itself. There is no separate application body because these fields are what
 * staff decide about: one form, and staff approve exactly what they would
 * publish.
 */
const listingSchema = z.object({
	headline: z.string().trim().max(INSTRUCTOR_HEADLINE_MAX).optional(),
	blurb: z.string().trim().max(INSTRUCTOR_BLURB_MAX).optional(),
	ratesNote: z.string().trim().max(INSTRUCTOR_RATES_NOTE_MAX).optional(),
	bookingUrl: z.string().trim().max(500).optional(),
	applicationNote: z.string().trim().max(INSTRUCTOR_APPLICATION_NOTE_MAX).optional()
});

/**
 * Apply to teach, or resubmit an application that was handed back.
 *
 * Guarded by `requireUser` alone — applying is open to any member, and the
 * service refuses anyone who already holds a grant. What it must **not** take is
 * a user id from the client: the applicant is whoever is signed in.
 */
export const applyToTeach = form(listingSchema, async (data) => {
	const currentUser = requireUser();
	try {
		await instructorService.apply(currentUser.id, data);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

/** Edit the listing. Legal while the application is open and once active. */
export const updateInstructorListing = form(listingSchema, async (data) => {
	const currentUser = requireUser();
	try {
		await instructorService.updateListing(currentUser.id, data);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

/**
 * "My book is full this term." The instructor's own switch, and deliberately not
 * staff's — it is the opposite fact from CMC suspending their terms.
 */
export const setAcceptingStudents = form(
	z.object({ accepting: z.enum(['true', 'false']) }),
	async (data) => {
		const currentUser = requireUser();
		try {
			await instructorService.setAcceptingStudents(currentUser.id, data.accepting === 'true');
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

/**
 * Withdraw an open application — a hard delete of the member's own row. Nothing
 * is kept because an application nobody acted on is not a record of anything.
 * The service refuses to touch an active grant.
 */
// `form('unchecked', …)` rather than `form(z.object({}), …)`: kit 2.70 rejects a
// bare empty object schema, and reports it as the "all booleans must be
// optional" error, which names a problem this form does not have.
export const withdrawApplication = form('unchecked', async () => {
	const currentUser = requireUser();
	try {
		await instructorService.withdraw(currentUser.id);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

/** The caller's own instructor record, or null. No argument — the subject is the session. */
export const getMyInstructor = query(async () => {
	const currentUser = requireUser();
	return instructorService.getByUserId(currentUser.id);
});

/** Whether this member's teaching listing would show a contact publicly. */
export const getMyContactStatus = query(async () => {
	const currentUser = requireUser();
	return publicContactStatus(currentUser.id);
});

// ---------------------------------------------------------------------------
// The listing
// ---------------------------------------------------------------------------

const filterSchema = z
	.object({ search: z.string().optional(), instrument: z.string().optional() })
	.optional();

/**
 * Two entry points rather than one with a viewer argument, because the
 * difference is the gate and a gate chosen by a parameter is a gate somebody can
 * pass the wrong value to. The public one takes no session at all.
 */
export const getPublicInstructors = query(filterSchema, async (filters) =>
	listInstructors('public', filters as InstructorFilters | undefined)
);

export const getMemberInstructors = query(filterSchema, async (filters) => {
	requireUser();
	return listInstructors('members', filters as InstructorFilters | undefined);
});
