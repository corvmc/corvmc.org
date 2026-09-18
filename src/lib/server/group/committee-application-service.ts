import { db } from '$lib/server/db';
import { and, desc, eq, inArray, isNull, sql, asc } from 'drizzle-orm';
import { DomainError } from '$lib/server/domain-error';
import { getRowCount } from '$lib/server/db';
import {
	committeeApplication,
	committeeApplicationChoice
} from '$lib/server/db/schema/committee-application';
import { group, groupMember } from '$lib/server/db/schema/group';
import { user } from '$lib/server/db/schema/authentication';
import { memberRefColumns, toMemberRef } from '$lib/server/entity/refs';
import { invite } from '$lib/server/band/band-service';
import type { CommitteeApplicationStatus } from '$lib/config';

/**
 * Applying to a committee, and a chair answering.
 *
 * The application is an event in time and the roster is the outcome, so nothing
 * here writes `group_member` except `accept`, which invites. See the table's
 * own comment for why this is not `group_member.status = 'requested'`.
 */

/** Decided means decided — a chair does not un-accept, they remove from the roster. */
const OPEN_STATUSES = ['submitted', 'contacted'] as const;

export class NotACommitteeError extends DomainError {
	readonly httpStatus = 422;

	constructor() {
		super('Applications are for committees. Bands and clubs join their own way.');
		this.name = 'NotACommitteeError';
	}
}

export class NoCommitteeChosenError extends DomainError {
	readonly httpStatus = 422;

	constructor() {
		super('Pick at least one committee to apply to.');
		this.name = 'NoCommitteeChosenError';
	}
}

export class ApplicationNotFoundError extends DomainError {
	readonly httpStatus = 404;

	constructor() {
		super('That application is no longer open.');
		this.name = 'ApplicationNotFoundError';
	}
}

/** Every committee a member can apply to, newest name order. */
export async function listCommittees() {
	return db
		.select({ id: group.id, name: group.name, slug: group.slug, bio: group.bio })
		.from(group)
		.where(and(eq(group.kind, 'committee'), isNull(group.deletedAt)))
		.orderBy(group.name);
}

export interface SubmitApplicationData {
	groupIds: string[];
	answers: Record<string, string>;
}

/**
 * One submission, several committees.
 *
 * Committees the applicant already sits on, or already has an open application
 * to, are dropped rather than rejected: the paper form is a set of ticks and
 * re-ticking one you are already on is a mistake, not a conflict worth an error
 * page. If that leaves nothing, `NoCommitteeChosenError` says so.
 */
export async function submitApplication(
	userId: string,
	data: SubmitApplicationData
): Promise<string> {
	if (data.groupIds.length === 0) throw new NoCommitteeChosenError();

	const committees = await db
		.select({ id: group.id })
		.from(group)
		.where(
			and(eq(group.kind, 'committee'), isNull(group.deletedAt), inArray(group.id, data.groupIds))
		);
	if (committees.length !== data.groupIds.length) throw new NotACommitteeError();

	const [onRoster, alreadyOpen] = await Promise.all([
		db
			.select({ groupId: groupMember.groupId })
			.from(groupMember)
			.where(and(eq(groupMember.userId, userId), inArray(groupMember.groupId, data.groupIds))),
		db
			.select({ groupId: committeeApplicationChoice.groupId })
			.from(committeeApplicationChoice)
			.innerJoin(
				committeeApplication,
				eq(committeeApplication.id, committeeApplicationChoice.applicationId)
			)
			.where(
				and(
					eq(committeeApplication.userId, userId),
					isNull(committeeApplication.withdrawnAt),
					inArray(committeeApplicationChoice.groupId, data.groupIds),
					inArray(committeeApplicationChoice.status, [...OPEN_STATUSES])
				)
			)
	]);

	const taken = new Set([...onRoster, ...alreadyOpen].map((r) => r.groupId));
	const wanted = data.groupIds.filter((id) => !taken.has(id));
	if (wanted.length === 0) throw new NoCommitteeChosenError();

	const [application] = await db
		.insert(committeeApplication)
		.values({ userId, answers: data.answers })
		.returning({ id: committeeApplication.id });

	await db
		.insert(committeeApplicationChoice)
		.values(wanted.map((groupId) => ({ applicationId: application.id, groupId })));

	return application.id;
}

/** The applicant pulling the whole thing. Decided halves keep their decision. */
export async function withdrawApplication(applicationId: string, userId: string): Promise<void> {
	const now = new Date();
	const result = await db
		.update(committeeApplication)
		.set({ withdrawnAt: now, updatedAt: now })
		.where(
			and(
				eq(committeeApplication.id, applicationId),
				eq(committeeApplication.userId, userId),
				isNull(committeeApplication.withdrawnAt)
			)
		);
	if (getRowCount(result) === 0) throw new ApplicationNotFoundError();
}

/** What the applicant sees: their own applications, newest first. */
export async function listForApplicant(userId: string) {
	const rows = await db
		.select({
			id: committeeApplication.id,
			answers: committeeApplication.answers,
			withdrawnAt: committeeApplication.withdrawnAt,
			createdAt: committeeApplication.createdAt,
			choiceStatus: committeeApplicationChoice.status,
			choiceNotes: committeeApplicationChoice.reviewNotes,
			groupName: group.name,
			groupSlug: group.slug
		})
		.from(committeeApplication)
		.innerJoin(
			committeeApplicationChoice,
			eq(committeeApplicationChoice.applicationId, committeeApplication.id)
		)
		.innerJoin(group, eq(group.id, committeeApplicationChoice.groupId))
		.where(eq(committeeApplication.userId, userId))
		.orderBy(desc(committeeApplication.createdAt), group.name);

	const byApplication = new Map<string, ReturnType<typeof shape>>();
	for (const row of rows) {
		let entry = byApplication.get(row.id);
		if (!entry) {
			entry = shape(row);
			byApplication.set(row.id, entry);
		}
		entry.committees.push({
			name: row.groupName,
			slug: row.groupSlug,
			status: row.choiceStatus,
			reviewNotes: row.choiceNotes
		});
	}
	return [...byApplication.values()];
}

function shape(row: {
	id: string;
	answers: Record<string, string>;
	withdrawnAt: Date | null;
	createdAt: Date;
}) {
	return {
		id: row.id,
		answers: row.answers,
		withdrawnAt: row.withdrawnAt,
		createdAt: row.createdAt,
		committees: [] as {
			name: string;
			slug: string;
			status: CommitteeApplicationStatus;
			reviewNotes: string | null;
		}[]
	};
}

/**
 * What one chair sees: applications naming their committee.
 *
 * Open ones by default. A withdrawn application drops out entirely — the
 * applicant took it back, and a chair acting on it would be answering nobody.
 */
export async function listForCommittee(groupId: string, opts?: { includeDecided?: boolean }) {
	const statuses = opts?.includeDecided
		? (['submitted', 'contacted', 'accepted', 'declined'] as const)
		: OPEN_STATUSES;

	const rows = await db
		.select({
			choiceId: committeeApplicationChoice.id,
			status: committeeApplicationChoice.status,
			reviewNotes: committeeApplicationChoice.reviewNotes,
			decidedAt: committeeApplicationChoice.decidedAt,
			applicationId: committeeApplication.id,
			answers: committeeApplication.answers,
			submittedAt: committeeApplication.createdAt,
			applicant: memberRefColumns()
		})
		.from(committeeApplicationChoice)
		.innerJoin(
			committeeApplication,
			eq(committeeApplication.id, committeeApplicationChoice.applicationId)
		)
		.innerJoin(user, eq(user.id, committeeApplication.userId))
		.where(
			and(
				eq(committeeApplicationChoice.groupId, groupId),
				isNull(committeeApplication.withdrawnAt),
				isNull(user.deletedAt),
				inArray(committeeApplicationChoice.status, [...statuses])
			)
		)
		.orderBy(committeeApplication.createdAt, asc(committeeApplication.id));

	return rows.map((row) => ({
		choiceId: row.choiceId,
		status: row.status,
		reviewNotes: row.reviewNotes,
		decidedAt: row.decidedAt,
		applicationId: row.applicationId,
		answers: row.answers,
		submittedAt: row.submittedAt,
		applicant: toMemberRef(row.applicant)
	}));
}

/** Resolve one open choice, scoped to the chair's own committee. */
async function takeOpenChoice(choiceId: string, groupId: string) {
	const [row] = await db
		.select({
			id: committeeApplicationChoice.id,
			userId: committeeApplication.userId
		})
		.from(committeeApplicationChoice)
		.innerJoin(
			committeeApplication,
			eq(committeeApplication.id, committeeApplicationChoice.applicationId)
		)
		.where(
			and(
				eq(committeeApplicationChoice.id, choiceId),
				eq(committeeApplicationChoice.groupId, groupId),
				isNull(committeeApplication.withdrawnAt),
				inArray(committeeApplicationChoice.status, [...OPEN_STATUSES])
			)
		)
		.limit(1);
	if (!row) throw new ApplicationNotFoundError();
	return row;
}

/** "A chair will contact you to discuss it" — recorded, so two chairs do not both call. */
export async function markContacted(
	choiceId: string,
	groupId: string,
	actorId: string
): Promise<void> {
	await takeOpenChoice(choiceId, groupId);
	await db
		.update(committeeApplicationChoice)
		.set({ status: 'contacted', decidedByUserId: actorId, updatedAt: new Date() })
		.where(eq(committeeApplicationChoice.id, choiceId));
}

/**
 * Accept, which invites rather than seating.
 *
 * `status = 'pending'` on the roster, so the applicant still accepts — being
 * offered a seat and taking one are two acts, and the invitation is the one
 * surface that already tells them.
 */
export async function acceptApplication(
	choiceId: string,
	groupId: string,
	actorId: string
): Promise<void> {
	const choice = await takeOpenChoice(choiceId, groupId);
	const now = new Date();

	await db
		.update(committeeApplicationChoice)
		.set({ status: 'accepted', decidedByUserId: actorId, decidedAt: now, updatedAt: now })
		.where(eq(committeeApplicationChoice.id, choiceId));

	await invite(groupId, choice.userId, 'member', null, actorId);
}

/** Decline, with the reason kept. The row stays: a declined application is a record. */
export async function declineApplication(
	choiceId: string,
	groupId: string,
	actorId: string,
	reviewNotes: string | null
): Promise<void> {
	await takeOpenChoice(choiceId, groupId);
	const now = new Date();
	await db
		.update(committeeApplicationChoice)
		.set({
			status: 'declined',
			reviewNotes: reviewNotes?.trim() || null,
			decidedByUserId: actorId,
			decidedAt: now,
			updatedAt: now
		})
		.where(eq(committeeApplicationChoice.id, choiceId));
}

/** The badge on a chair's nav row. */
export async function countOpenForCommittee(groupId: string): Promise<number> {
	const [row] = await db
		.select({ total: sql<number>`count(*)` })
		.from(committeeApplicationChoice)
		.innerJoin(
			committeeApplication,
			eq(committeeApplication.id, committeeApplicationChoice.applicationId)
		)
		.where(
			and(
				eq(committeeApplicationChoice.groupId, groupId),
				isNull(committeeApplication.withdrawnAt),
				inArray(committeeApplicationChoice.status, [...OPEN_STATUSES])
			)
		);
	return Number(row?.total ?? 0);
}

/**
 * Every committee with something waiting, for a reviewer who holds no seat.
 *
 * A chair reads their own on the club page. This is the other door: a headless
 * committee has no chair to read it, and the volunteer coordinator answers for
 * all six rather than one.
 */
export async function listOpenByCommittee() {
	const committees = await listCommittees();
	const perCommittee = await Promise.all(
		committees.map(async (committee) => ({
			...committee,
			applications: await listForCommittee(committee.id)
		}))
	);
	return perCommittee.filter((c) => c.applications.length > 0);
}
