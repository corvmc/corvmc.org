import { getByUserId } from './instructor-service';
import { InstructorNotFoundError, InstructorNotActiveError } from './instructor-service';
import type { Instructor } from '$lib/server/db/schema/instructor';

/**
 * Assert the member may book teaching time, and hand back the record so the
 * caller has `instructor.id` for `bookerId` without a second read.
 *
 * **The check is positive.** `status !== 'active'` refuses `requested`,
 * `rejected`, `paused` and `retired` alike — and would refuse a sixth value
 * added tomorrow. Written as `!== 'retired'` it would admit two of those today
 * and every new one forever, which is the failure `groupMemberStatuses`
 * documents and the reason an applicant cannot book *by construction* rather
 * than by a check somebody remembered to write.
 *
 * The user id is an explicit argument, never read from `params`. Remote
 * functions take their params from a client header describing the calling page,
 * so a guard that read one would be authorizing against untrusted input.
 *
 * Modelled on `requireActiveVolunteer(userId)`, down to the signature.
 */
export async function requireInstructor(userId: string): Promise<Instructor> {
	const row = await getByUserId(userId);
	if (!row) throw new InstructorNotFoundError();
	if (row.status !== 'active') throw new InstructorNotActiveError(row.status);
	return row;
}
