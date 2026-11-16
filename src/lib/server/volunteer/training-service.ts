import { db } from '#lib/server/db/index.js';
import {
	volunteerRole,
	volunteerRoleCertification,
	volunteerShift,
	volunteerSignup,
	workOrder
} from '#lib/server/db/schema/volunteer.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { alias } from 'drizzle-orm/sqlite-core';
import { and, asc, desc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { DomainError } from '#lib/server/errors.js';
import { memberRefColumns, toMemberRef } from '#lib/server/entity/refs.js';
import type { MemberRef } from '#lib/types/entity.js';

// ---------------------------------------------------------------------------
// Training on a shift (#2720)
// ---------------------------------------------------------------------------
// A signup can name another signup on the same shift as the one it trained
// under. These are integrity rules, not workflow gates: a supervisor on a
// different shift, or a member supervising themselves, is not a training.
// ---------------------------------------------------------------------------

export class TrainingValidationError extends DomainError {
	readonly httpStatus = 400;
	constructor(message: string) {
		super(message);
	}
}

export class TrainingNotAllowedError extends DomainError {
	readonly httpStatus = 403;
	constructor() {
		super('Only staff or the supervisor can change who this person trained under.');
	}
}

async function loadSignup(id: string) {
	const [row] = await db
		.select({
			id: volunteerSignup.id,
			shiftId: volunteerSignup.shiftId,
			userId: volunteerSignup.userId,
			status: volunteerSignup.status,
			supervisingSignupId: volunteerSignup.supervisingSignupId
		})
		.from(volunteerSignup)
		.where(eq(volunteerSignup.id, id))
		.limit(1);
	return row ?? null;
}

/**
 * Set or clear the signup `signupId` trained under. Staff may set anyone; a
 * member may only name their own signup, and only clear their own.
 */
export async function setSupervisingSignup(data: {
	signupId: string;
	supervisingSignupId: string | null;
	actorUserId: string;
	actorIsStaff: boolean;
}): Promise<void> {
	const trainee = await loadSignup(data.signupId);
	if (!trainee) throw new TrainingValidationError('That signup no longer exists.');

	const current = trainee.supervisingSignupId
		? await loadSignup(trainee.supervisingSignupId)
		: null;
	const next = data.supervisingSignupId ? await loadSignup(data.supervisingSignupId) : null;

	if (data.supervisingSignupId) {
		if (!next) throw new TrainingValidationError('That supervisor is not on the shift.');
		if (next.shiftId !== trainee.shiftId) {
			throw new TrainingValidationError('The supervisor has to be on the same shift.');
		}
		if (next.userId === trainee.userId) {
			throw new TrainingValidationError('A member cannot supervise themselves.');
		}
		if (next.status === 'cancelled') {
			throw new TrainingValidationError('That supervisor is not on the shift.');
		}
	}

	if (!data.actorIsStaff) {
		// Replacing or clearing someone else's supervision is staff's call.
		if (current && current.userId !== data.actorUserId) throw new TrainingNotAllowedError();
		if (next && next.userId !== data.actorUserId) throw new TrainingNotAllowedError();
		if (!current && !next) throw new TrainingNotAllowedError();
	}

	await db
		.update(volunteerSignup)
		.set({ supervisingSignupId: next?.id ?? null, updatedAt: new Date() })
		.where(eq(volunteerSignup.id, trainee.id));
}

export interface TrainingShift {
	signupId: string;
	roleName: string;
	startsAt: Date;
	supervisorName: string;
	/** The clearances this shift's role asks for: what it can count towards. */
	certificationIds: string[];
}

/** A member's completed shifts worked under a supervisor, newest first. */
export async function listTrainingShifts(userId: string): Promise<TrainingShift[]> {
	const supervisorSignup = alias(volunteerSignup, 'supervisor_signup');
	const supervisor = alias(user, 'supervisor');

	const rows = await db
		.select({
			signupId: volunteerSignup.id,
			roleId: volunteerRole.id,
			roleName: volunteerRole.name,
			startsAt: volunteerShift.startsAt,
			supervisorName: supervisor.name
		})
		.from(volunteerSignup)
		.innerJoin(volunteerShift, eq(volunteerShift.id, volunteerSignup.shiftId))
		.innerJoin(workOrder, eq(workOrder.id, volunteerShift.workOrderId))
		.innerJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.innerJoin(supervisorSignup, eq(supervisorSignup.id, volunteerSignup.supervisingSignupId))
		.innerJoin(supervisor, eq(supervisor.id, supervisorSignup.userId))
		.where(
			and(
				eq(volunteerSignup.userId, userId),
				eq(volunteerSignup.status, 'completed'),
				isNotNull(volunteerSignup.supervisingSignupId)
			)
		)
		.orderBy(desc(volunteerShift.startsAt));

	if (rows.length === 0) return [];

	const requirements = await db
		.select({
			roleId: volunteerRoleCertification.volunteerRoleId,
			certificationId: volunteerRoleCertification.certificationId
		})
		.from(volunteerRoleCertification)
		.where(
			inArray(volunteerRoleCertification.volunteerRoleId, [...new Set(rows.map((r) => r.roleId))])
		);

	return rows.map(({ roleId, ...row }) => ({
		...row,
		certificationIds: requirements.filter((q) => q.roleId === roleId).map((q) => q.certificationId)
	}));
}

export interface CrewMate {
	signupId: string;
	member: MemberRef;
	/** Trained under the reader's own signup. */
	trainedUnderMe: boolean;
	/** Trained under somebody else on the shift, which only staff can change. */
	trainedUnderOther: boolean;
}

/** Everyone else still on the shift of `mySignupId`, for the supervisor's page. */
export async function listCrewMates(mySignupId: string, shiftId: string): Promise<CrewMate[]> {
	const rows = await db
		.select({
			signupId: volunteerSignup.id,
			member: memberRefColumns(),
			supervisingSignupId: volunteerSignup.supervisingSignupId
		})
		.from(volunteerSignup)
		.innerJoin(user, eq(user.id, volunteerSignup.userId))
		.where(
			and(
				eq(volunteerSignup.shiftId, shiftId),
				ne(volunteerSignup.id, mySignupId),
				ne(volunteerSignup.status, 'cancelled')
			)
		)
		.orderBy(asc(volunteerSignup.claimedAt));

	return rows.map((r) => ({
		signupId: r.signupId,
		member: toMemberRef(r.member),
		trainedUnderMe: r.supervisingSignupId === mySignupId,
		trainedUnderOther: !!r.supervisingSignupId && r.supervisingSignupId !== mySignupId
	}));
}
