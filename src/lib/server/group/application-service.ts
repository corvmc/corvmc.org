import { db } from '$lib/server/db';
import { and, desc, eq, inArray, isNull, sql, asc } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { DomainError } from '$lib/server/domain-error';
import { getRowCount } from '$lib/server/db';
import { groupApplication, groupApplicationChoice } from '$lib/server/db/schema/group-application';
import { group, groupMember } from '$lib/server/db/schema/group';
import { user } from '$lib/server/db/schema/authentication';
import { memberRefColumns, toMemberRef } from '$lib/server/entity/refs';
import { invite } from '$lib/server/band/band-service';
import { domainEvents } from '$lib/server/event-bus/event-bus';
import {
	groupApplicationQuestions,
	type ApplicationGroupKind,
	type GroupApplicationStatus
} from '$lib/config';

/**
 * Applying to a `by_application` group, and a reviewer answering.
 *
 * The application is an event in time and the roster is the outcome, so nothing
 * here writes `group_member` except `accept`, which invites.
 */

/** Decided means decided — a reviewer does not un-accept, they remove from the roster. */
const OPEN_STATUSES = ['submitted', 'contacted'] as const;

export class NotAcceptingApplicationsError extends DomainError {
	readonly httpStatus = 422;

	constructor() {
		super('That group does not take applications. Ask someone in it instead.');
		this.name = 'NotAcceptingApplicationsError';
	}
}

export class OneGroupPerApplicationError extends DomainError {
	readonly httpStatus = 422;

	constructor() {
		super('Apply to one group at a time. Only committees can be applied to together.');
		this.name = 'OneGroupPerApplicationError';
	}
}

export class NothingToApplyForError extends DomainError {
	readonly httpStatus = 422;

	constructor() {
		super('Pick a group you have not already applied to or joined.');
		this.name = 'NothingToApplyForError';
	}
}

export class ApplicationNotFoundError extends DomainError {
	readonly httpStatus = 404;

	constructor() {
		super('That application is no longer open.');
		this.name = 'ApplicationNotFoundError';
	}
}

/** Every live committee, name order. `acceptingOnly` narrows to the ones that take applications. */
export async function listCommittees(opts?: { acceptingOnly?: boolean }) {
	return db
		.select({ id: group.id, name: group.name, slug: group.slug, bio: group.bio })
		.from(group)
		.where(
			and(
				eq(group.kind, 'committee'),
				isNull(group.deletedAt),
				opts?.acceptingOnly ? eq(group.joinPolicy, 'by_application') : undefined
			)
		)
		.orderBy(group.name);
}

export interface SubmitApplicationData {
	groupIds: string[];
	answers: Record<string, string>;
}

/**
 * One submission: one group, or several committees.
 *
 * Every group must take applications, read from the row. Groups the applicant
 * is already on (a pending invitation included) or already has an open choice
 * for are dropped rather than rejected — re-ticking a box is a mistake, not a
 * conflict. If that leaves nothing, `NothingToApplyForError` says so.
 */
export async function submitApplication(
	userId: string,
	data: SubmitApplicationData
): Promise<string> {
	const groupIds = [...new Set(data.groupIds)];
	if (groupIds.length === 0) throw new NothingToApplyForError();

	const groups = await db
		.select({ id: group.id, kind: group.kind, joinPolicy: group.joinPolicy })
		.from(group)
		.where(and(isNull(group.deletedAt), inArray(group.id, groupIds)));
	if (groups.length !== groupIds.length) throw new NotAcceptingApplicationsError();
	if (groups.some((g) => g.joinPolicy !== 'by_application' || g.kind === 'band')) {
		throw new NotAcceptingApplicationsError();
	}
	const kinds = new Set(groups.map((g) => g.kind as ApplicationGroupKind));
	if (groupIds.length > 1 && (kinds.size > 1 || !kinds.has('committee'))) {
		throw new OneGroupPerApplicationError();
	}
	const [kind] = kinds;

	const [onRoster, alreadyOpen] = await Promise.all([
		db
			.select({ groupId: groupMember.groupId })
			.from(groupMember)
			.where(and(eq(groupMember.userId, userId), inArray(groupMember.groupId, groupIds))),
		db
			.select({ groupId: groupApplicationChoice.groupId })
			.from(groupApplicationChoice)
			.innerJoin(groupApplication, eq(groupApplication.id, groupApplicationChoice.applicationId))
			.where(
				and(
					eq(groupApplication.userId, userId),
					isNull(groupApplication.withdrawnAt),
					inArray(groupApplicationChoice.groupId, groupIds),
					inArray(groupApplicationChoice.status, [...OPEN_STATUSES])
				)
			)
	]);

	const taken = new Set([...onRoster, ...alreadyOpen].map((r) => r.groupId));
	const wanted = groupIds.filter((id) => !taken.has(id));
	if (wanted.length === 0) throw new NothingToApplyForError();

	const answers: Record<string, string> = {};
	for (const q of groupApplicationQuestions[kind]) {
		const value = data.answers[q.id];
		if (typeof value === 'string' && value.trim().length > 0) answers[q.id] = value.trim();
	}

	const [application] = await db
		.insert(groupApplication)
		.values({ userId, answers })
		.returning({ id: groupApplication.id });

	await db
		.insert(groupApplicationChoice)
		.values(wanted.map((groupId) => ({ applicationId: application.id, groupId })));

	// One per group, since each has its own reviewers. The listener catches its own failures.
	for (const groupId of wanted) {
		await domainEvents.emit('group.application_submitted', { groupId, applicantUserId: userId });
	}

	return application.id;
}

/** The applicant pulling the whole thing. Decided halves keep their decision. */
export async function withdrawApplication(applicationId: string, userId: string): Promise<void> {
	const now = new Date();
	const result = await db
		.update(groupApplication)
		.set({ withdrawnAt: now, updatedAt: now })
		.where(
			and(
				eq(groupApplication.id, applicationId),
				eq(groupApplication.userId, userId),
				isNull(groupApplication.withdrawnAt)
			)
		);
	if (getRowCount(result) === 0) throw new ApplicationNotFoundError();
}

/** What the applicant sees: their own applications, newest first, optionally one kind's. */
export async function listForApplicant(userId: string, opts?: { kind?: ApplicationGroupKind }) {
	const rows = await db
		.select({
			id: groupApplication.id,
			answers: groupApplication.answers,
			withdrawnAt: groupApplication.withdrawnAt,
			createdAt: groupApplication.createdAt,
			choiceStatus: groupApplicationChoice.status,
			choiceNotes: groupApplicationChoice.reviewNotes,
			groupId: group.id,
			groupKind: group.kind,
			groupName: group.name,
			groupSlug: group.slug
		})
		.from(groupApplication)
		.innerJoin(
			groupApplicationChoice,
			eq(groupApplicationChoice.applicationId, groupApplication.id)
		)
		.innerJoin(group, eq(group.id, groupApplicationChoice.groupId))
		.where(
			and(eq(groupApplication.userId, userId), opts?.kind ? eq(group.kind, opts.kind) : undefined)
		)
		.orderBy(desc(groupApplication.createdAt), group.name);

	const byApplication = new Map<string, ReturnType<typeof shape>>();
	for (const row of rows) {
		let entry = byApplication.get(row.id);
		if (!entry) {
			entry = shape(row);
			byApplication.set(row.id, entry);
		}
		entry.groups.push({
			id: row.groupId,
			kind: row.groupKind,
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
		groups: [] as {
			id: string;
			kind: string;
			name: string;
			slug: string;
			status: GroupApplicationStatus;
			reviewNotes: string | null;
		}[]
	};
}

/** Does this user have an open choice for this group? The public page's "already applied". */
export async function hasOpenApplication(groupId: string, userId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: groupApplicationChoice.id })
		.from(groupApplicationChoice)
		.innerJoin(groupApplication, eq(groupApplication.id, groupApplicationChoice.applicationId))
		.where(
			and(
				eq(groupApplicationChoice.groupId, groupId),
				eq(groupApplication.userId, userId),
				isNull(groupApplication.withdrawnAt),
				inArray(groupApplicationChoice.status, [...OPEN_STATUSES])
			)
		)
		.limit(1);
	return !!row;
}

/**
 * What one group's reviewers see: applications naming it.
 *
 * Open ones by default. A withdrawn application drops out entirely — the
 * applicant took it back, and a reviewer acting on it would be answering nobody.
 */
export async function listForGroup(groupId: string, opts?: { includeDecided?: boolean }) {
	const statuses = opts?.includeDecided
		? (['submitted', 'contacted', 'accepted', 'declined'] as const)
		: OPEN_STATUSES;

	const rows = await db
		.select({
			choiceId: groupApplicationChoice.id,
			status: groupApplicationChoice.status,
			reviewNotes: groupApplicationChoice.reviewNotes,
			decidedAt: groupApplicationChoice.decidedAt,
			applicationId: groupApplication.id,
			answers: groupApplication.answers,
			submittedAt: groupApplication.createdAt,
			applicant: memberRefColumns()
		})
		.from(groupApplicationChoice)
		.innerJoin(groupApplication, eq(groupApplication.id, groupApplicationChoice.applicationId))
		.innerJoin(user, eq(user.id, groupApplication.userId))
		.where(
			and(
				eq(groupApplicationChoice.groupId, groupId),
				isNull(groupApplication.withdrawnAt),
				isNull(user.deletedAt),
				inArray(groupApplicationChoice.status, [...statuses])
			)
		)
		.orderBy(groupApplication.createdAt, asc(groupApplication.id));

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

/** Resolve one open choice, scoped to the reviewer's own group. */
async function takeOpenChoice(choiceId: string, groupId: string) {
	const [row] = await db
		.select({
			id: groupApplicationChoice.id,
			userId: groupApplication.userId
		})
		.from(groupApplicationChoice)
		.innerJoin(groupApplication, eq(groupApplication.id, groupApplicationChoice.applicationId))
		.where(
			and(
				eq(groupApplicationChoice.id, choiceId),
				eq(groupApplicationChoice.groupId, groupId),
				isNull(groupApplication.withdrawnAt),
				inArray(groupApplicationChoice.status, [...OPEN_STATUSES])
			)
		)
		.limit(1);
	if (!row) throw new ApplicationNotFoundError();
	return row;
}

/** "A chair will contact you to discuss it" — recorded, so two reviewers do not both call. */
export async function markContacted(
	choiceId: string,
	groupId: string,
	actorId: string
): Promise<void> {
	await takeOpenChoice(choiceId, groupId);
	await db
		.update(groupApplicationChoice)
		.set({ status: 'contacted', decidedByUserId: actorId, updatedAt: new Date() })
		.where(eq(groupApplicationChoice.id, choiceId));
}

/**
 * Accept, which invites rather than seating (#1729).
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
		.update(groupApplicationChoice)
		.set({ status: 'accepted', decidedByUserId: actorId, decidedAt: now, updatedAt: now })
		.where(eq(groupApplicationChoice.id, choiceId));

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
		.update(groupApplicationChoice)
		.set({
			status: 'declined',
			reviewNotes: reviewNotes?.trim() || null,
			decidedByUserId: actorId,
			decidedAt: now,
			updatedAt: now
		})
		.where(eq(groupApplicationChoice.id, choiceId));
}

/**
 * A correlated count of `groupIdColumn`'s open choices, for a select over groups.
 * Same filters as `listForGroup`, so a badge matches the card it links to.
 */
export function openApplicationCount(groupIdColumn: SQLiteColumn) {
	const counted = db
		.select({ total: sql<number>`count(*)` })
		.from(groupApplicationChoice)
		.innerJoin(groupApplication, eq(groupApplication.id, groupApplicationChoice.applicationId))
		.innerJoin(user, eq(user.id, groupApplication.userId))
		.where(
			and(
				eq(groupApplicationChoice.groupId, groupIdColumn),
				isNull(groupApplication.withdrawnAt),
				isNull(user.deletedAt),
				inArray(groupApplicationChoice.status, [...OPEN_STATUSES])
			)
		);
	return sql<number>`(${counted})`;
}

/** The badge on a reviewer's nav row. */
export async function countOpenForGroup(groupId: string): Promise<number> {
	const [row] = await db
		.select({ total: sql<number>`count(*)` })
		.from(groupApplicationChoice)
		.innerJoin(groupApplication, eq(groupApplication.id, groupApplicationChoice.applicationId))
		.where(
			and(
				eq(groupApplicationChoice.groupId, groupId),
				isNull(groupApplication.withdrawnAt),
				inArray(groupApplicationChoice.status, [...OPEN_STATUSES])
			)
		);
	return Number(row?.total ?? 0);
}

/**
 * Every committee with something waiting, for a reviewer who holds no seat.
 *
 * A chair reads their own on the group page. This is the other door: a
 * headless committee has no chair to read it, and the volunteer coordinator
 * answers for all six rather than one. Committees only (#1730).
 */
export async function listOpenByCommittee() {
	const committees = await listCommittees();
	const perCommittee = await Promise.all(
		committees.map(async (committee) => ({
			...committee,
			applications: await listForGroup(committee.id)
		}))
	);
	return perCommittee.filter((c) => c.applications.length > 0);
}
