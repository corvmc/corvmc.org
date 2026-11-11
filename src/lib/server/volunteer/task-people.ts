import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import {
	volunteerShift,
	volunteerSignup,
	workOrderAssignee
} from '#lib/server/db/schema/volunteer.js';
import { createJob, type CreateJobInput } from '#lib/server/contractor/contractor-job-service.js';
import { releaseSignup } from './volunteer-signup-service';
import { removeAllAssignees } from './assignee-service';

// ---------------------------------------------------------------------------
// Who is on a task: its assignees, and sign-ups on its shifts still to end.
// Delegating the task to a contractor takes all of them off (#2518), from the
// project task list and from the task page alike.
// ---------------------------------------------------------------------------

/** Live sign-ups on the task's shifts that have not ended: who a switch takes off. */
export async function liveSignupsOn(workOrderId: string) {
	return db
		.select({ id: volunteerSignup.id, userId: volunteerSignup.userId })
		.from(volunteerSignup)
		.innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
		.where(
			and(
				eq(volunteerShift.workOrderId, workOrderId),
				isNull(volunteerShift.cancelledAt),
				gt(volunteerShift.endsAt, new Date()),
				inArray(volunteerSignup.status, ['claimed', 'confirmed'])
			)
		);
}

export async function assigneesOf(workOrderId: string) {
	return db
		.select({ userId: workOrderAssignee.userId })
		.from(workOrderAssignee)
		.where(eq(workOrderAssignee.workOrderId, workOrderId));
}

/**
 * Take everybody off the task: assignees removed, sign-ups on shifts still to
 * come released (which tells each person), and those shifts called off.
 */
export async function takeEveryoneOff(
	workOrderId: string,
	by: string | null,
	signups: { id: string }[]
) {
	for (const s of signups) await releaseSignup(s.id);
	const now = new Date();
	await db.batch([
		removeAllAssignees(workOrderId),
		db
			.update(volunteerShift)
			.set({ cancelledAt: now, cancelledByUserId: by, updatedAt: now })
			.where(
				and(
					eq(volunteerShift.workOrderId, workOrderId),
					isNull(volunteerShift.cancelledAt),
					gt(volunteerShift.endsAt, now)
				)
			)
	]);
}

export type EngageOnTaskResult =
	| { status: 'needs_confirmation'; people: number }
	| { status: 'done'; job: Awaited<ReturnType<typeof createJob>>; cancelledSignups: number };

/**
 * Engage a contractor on a task. Warn, record, allow: with people on it the
 * first call only says how many; with `confirm` the engagement is made, then
 * its assignees are removed and its shifts still to come called off.
 */
export async function engageContractorOnTask(
	input: CreateJobInput & { workOrderId: string },
	confirm: boolean
): Promise<EngageOnTaskResult> {
	const live = await liveSignupsOn(input.workOrderId);
	const people = live.length + (await assigneesOf(input.workOrderId)).length;
	if (people > 0 && !confirm) return { status: 'needs_confirmation', people };
	// The engagement first: it refuses an archived contractor before anything moves.
	const job = await createJob(input);
	await takeEveryoneOff(input.workOrderId, input.requestedByUserId ?? null, live);
	return { status: 'done', job, cancelledSignups: live.length };
}
