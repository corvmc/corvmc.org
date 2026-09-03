import { db } from '$lib/server/db';
import {
	volunteerShiftFeedback,
	volunteerSignup,
	workOrder,
	volunteerRole
} from '$lib/server/db/schema/volunteer';
import { and, avg, count, desc, eq, sql } from 'drizzle-orm';
import { DomainError } from '$lib/server/errors';
import {
	SHIFT_FEEDBACK_COMMENT_MAX,
	SHIFT_FEEDBACK_MAX_RATING,
	SHIFT_FEEDBACK_MIN_RATING
} from '$lib/config';
import type { VolunteerShiftFeedback } from '$lib/server/db/schema/volunteer';

// ---------------------------------------------------------------------------
// Post-shift feedback
// ---------------------------------------------------------------------------
// Two questions and a comment box, once per signup. The per-role aggregate is
// the version that changes anything: a role scoring badly on "were you set up
// to succeed?" is a briefing problem, not a volunteer problem.
// ---------------------------------------------------------------------------

export class FeedbackNotAvailableError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('This shift is not yours to review, or has not finished yet.');
	}
}

export class FeedbackAlreadySubmittedError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('You already answered for this shift — thank you!');
	}
}

export class FeedbackValidationError extends DomainError {
	readonly httpStatus = 400;
	constructor(message: string) {
		super(message);
	}
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * One response per signup, owner only, completed shifts only.
 *
 * The ownership check matters because the form arrives from an emailed link
 * carrying the signup id — the id is not a secret, so the session has to be
 * the thing that authorizes.
 */
export async function submitFeedback(data: {
	signupId: string;
	userId: string;
	rating: number;
	wasSetUp: boolean;
	comment?: string | null;
}): Promise<VolunteerShiftFeedback> {
	if (
		!Number.isInteger(data.rating) ||
		data.rating < SHIFT_FEEDBACK_MIN_RATING ||
		data.rating > SHIFT_FEEDBACK_MAX_RATING
	) {
		throw new FeedbackValidationError('Pick a rating from 1 to 5.');
	}

	const comment = data.comment?.trim() ?? '';
	if (comment.length > SHIFT_FEEDBACK_COMMENT_MAX) {
		throw new FeedbackValidationError(
			`Keep the comment under ${SHIFT_FEEDBACK_COMMENT_MAX} characters.`
		);
	}

	const [signup] = await db
		.select({ id: volunteerSignup.id, status: volunteerSignup.status })
		.from(volunteerSignup)
		.where(and(eq(volunteerSignup.id, data.signupId), eq(volunteerSignup.userId, data.userId)))
		.limit(1);

	if (!signup || signup.status !== 'completed') throw new FeedbackNotAvailableError();

	try {
		const [row] = await db
			.insert(volunteerShiftFeedback)
			.values({
				signupId: data.signupId,
				rating: data.rating,
				wasSetUp: data.wasSetUp,
				comment: comment || null
			})
			.returning();
		return row;
	} catch (err) {
		// The unique signupId column fired — they already answered.
		if (err instanceof Error && /UNIQUE constraint failed/i.test(err.message)) {
			throw new FeedbackAlreadySubmittedError();
		}
		throw err;
	}
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** The context the member-facing form shows above the two questions. */
export async function getFeedbackContext(signupId: string, userId: string) {
	const [row] = await db
		.select({
			signupId: volunteerSignup.id,
			status: volunteerSignup.status,
			roleName: volunteerRole.name,
			startsAt: workOrder.startsAt,
			endsAt: workOrder.endsAt,
			alreadySubmitted: sql<number>`exists (
				select 1 from "volunteer_shift_feedback" f where f."signup_id" = ${volunteerSignup.id}
			)`
		})
		.from(volunteerSignup)
		.innerJoin(workOrder, eq(workOrder.id, volunteerSignup.shiftId))
		.innerJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.where(and(eq(volunteerSignup.id, signupId), eq(volunteerSignup.userId, userId)))
		.limit(1);

	if (!row || row.status !== 'completed') return null;

	return {
		signupId: row.signupId,
		roleName: row.roleName,
		startsAt: row.startsAt,
		endsAt: row.endsAt,
		alreadySubmitted: Boolean(row.alreadySubmitted)
	};
}

export interface ShiftFeedbackRow {
	signupId: string;
	rating: number;
	wasSetUp: boolean;
	comment: string | null;
	submittedAt: Date;
}

/** Responses for one shift — the staff detail view. */
export async function listFeedbackForShift(shiftId: string): Promise<ShiftFeedbackRow[]> {
	return db
		.select({
			signupId: volunteerShiftFeedback.signupId,
			rating: volunteerShiftFeedback.rating,
			wasSetUp: volunteerShiftFeedback.wasSetUp,
			comment: volunteerShiftFeedback.comment,
			submittedAt: volunteerShiftFeedback.submittedAt
		})
		.from(volunteerShiftFeedback)
		.innerJoin(volunteerSignup, eq(volunteerSignup.id, volunteerShiftFeedback.signupId))
		.where(eq(volunteerSignup.shiftId, shiftId))
		.orderBy(desc(volunteerShiftFeedback.submittedAt));
}

export interface RoleFeedbackSummary {
	volunteerRoleId: string;
	roleName: string;
	responses: number;
	averageRating: number;
	/** 0–1: the share who answered yes to "were you set up to succeed?" */
	setUpShare: number;
	latestComments: { comment: string; rating: number; submittedAt: Date }[];
}

/**
 * The per-role rollup. Deliberately anonymous — no member names. Feedback
 * exists to fix briefings and setups, and attaching names would just teach
 * volunteers to answer politely.
 */
export async function summarizeFeedbackByRole(): Promise<RoleFeedbackSummary[]> {
	const rows = await db
		.select({
			volunteerRoleId: workOrder.volunteerRoleId,
			roleName: volunteerRole.name,
			responses: count(),
			averageRating: avg(volunteerShiftFeedback.rating),
			setUpShare: avg(
				sql<number>`case when ${volunteerShiftFeedback.wasSetUp} then 1.0 else 0.0 end`
			)
		})
		.from(volunteerShiftFeedback)
		.innerJoin(volunteerSignup, eq(volunteerSignup.id, volunteerShiftFeedback.signupId))
		.innerJoin(workOrder, eq(workOrder.id, volunteerSignup.shiftId))
		.innerJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.groupBy(workOrder.volunteerRoleId)
		.orderBy(desc(count()));

	const summaries: RoleFeedbackSummary[] = [];
	for (const row of rows) {
		const comments = await db
			.select({
				comment: volunteerShiftFeedback.comment,
				rating: volunteerShiftFeedback.rating,
				submittedAt: volunteerShiftFeedback.submittedAt
			})
			.from(volunteerShiftFeedback)
			.innerJoin(volunteerSignup, eq(volunteerSignup.id, volunteerShiftFeedback.signupId))
			.innerJoin(workOrder, eq(workOrder.id, volunteerSignup.shiftId))
			.where(
				and(
					eq(workOrder.volunteerRoleId, row.volunteerRoleId),
					sql`${volunteerShiftFeedback.comment} is not null`
				)
			)
			.orderBy(desc(volunteerShiftFeedback.submittedAt))
			.limit(5);

		summaries.push({
			volunteerRoleId: row.volunteerRoleId,
			roleName: row.roleName,
			responses: Number(row.responses),
			averageRating: Number(row.averageRating ?? 0),
			setUpShare: Number(row.setUpShare ?? 0),
			latestComments: comments.filter((c): c is typeof c & { comment: string } => !!c.comment)
		});
	}

	return summaries;
}
