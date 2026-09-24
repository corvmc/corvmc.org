import {
	and,
	asc,
	count,
	desc,
	eq,
	exists,
	inArray,
	isNotNull,
	isNull,
	lte,
	or,
	sql
} from 'drizzle-orm';
import { db } from '$lib/server/db';
import { DomainError } from '$lib/server/domain-error';
import {
	ballot,
	ballotChoice,
	ballotElector,
	ballotElectorOverride,
	ballotOption,
	ballotParticipation,
	ballotRecordedVote,
	type Ballot,
	type BallotCertifiedResult
} from '$lib/server/db/schema/ballot';
import { user } from '$lib/server/db/schema/authentication';
import { group, groupMember } from '$lib/server/db/schema/group';
import { memberOrientation } from '$lib/server/db/schema/volunteer';
import { config } from '$lib/server/site-config/site-config-service';
import { domainEvents } from '$lib/server/event-bus/event-bus';
import { recordAuditEntry } from '$lib/server/audit/audit-service';
import {
	BALLOT_DESCRIPTION_MAX,
	BALLOT_OPTION_LABEL_MAX,
	BALLOT_OPTIONS_MAX,
	BALLOT_OPTIONS_MIN,
	BALLOT_REASON_MAX,
	BALLOT_TITLE_MAX,
	type BallotKind,
	type BallotStatus
} from '$lib/config';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class BallotNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Ballot not found');
	}
}

export class BallotValidationError extends DomainError {
	readonly httpStatus = 400;
}

/** The ballot is not in a state that allows this: not open, already certified, and so on. */
export class BallotStateError extends DomainError {
	readonly httpStatus = 409;
}

export class TallyHiddenError extends DomainError {
	readonly httpStatus = 403;
	constructor() {
		super('The result is hidden until the ballot closes');
	}
}

export class NotAnElectorError extends DomainError {
	readonly httpStatus = 403;
	constructor() {
		super('You are not on the roll for this ballot');
	}
}

export class AlreadyVotedError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('You have already voted on this ballot');
	}
}

export class NotCertifierError extends DomainError {
	readonly httpStatus = 403;
	constructor() {
		super('Only the named certifier can certify this ballot');
	}
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

type StatusFields = Pick<Ballot, 'openedAt' | 'closesAt' | 'cancelledAt' | 'certifiedAt'>;

export function ballotStatusOf(b: StatusFields, now: Date = new Date()): BallotStatus {
	if (b.cancelledAt) return 'cancelled';
	if (b.certifiedAt) return 'certified';
	if (!b.openedAt) return 'draft';
	return now.getTime() < b.closesAt.getTime() ? 'open' : 'closed';
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getBallot(ballotId: string): Promise<Ballot> {
	const [row] = await db.select().from(ballot).where(eq(ballot.id, ballotId)).limit(1);
	if (!row) throw new BallotNotFoundError();
	return row;
}

export interface BallotDetail extends Ballot {
	options: Array<{ id: string; label: string }>;
	group: { id: string; name: string; slug: string } | null;
	certifier: { id: string; name: string } | null;
}

export async function getBallotDetail(ballotId: string): Promise<BallotDetail> {
	const [row] = await db
		.select({
			ballot,
			groupName: group.name,
			groupSlug: group.slug,
			certifierName: user.name
		})
		.from(ballot)
		.leftJoin(group, eq(group.id, ballot.groupId))
		.leftJoin(user, eq(user.id, ballot.certifierId))
		.where(eq(ballot.id, ballotId))
		.limit(1);
	if (!row) throw new BallotNotFoundError();

	const options = await db
		.select({ id: ballotOption.id, label: ballotOption.label })
		.from(ballotOption)
		.where(eq(ballotOption.ballotId, ballotId))
		.orderBy(asc(ballotOption.position));

	const b = row.ballot;
	return {
		...b,
		options,
		group: b.groupId
			? { id: b.groupId, name: row.groupName ?? '', slug: row.groupSlug ?? '' }
			: null,
		certifier: b.certifierId ? { id: b.certifierId, name: row.certifierName ?? '' } : null
	};
}

export async function isElector(ballotId: string, userId: string): Promise<boolean> {
	const [row] = await db
		.select({ userId: ballotElector.userId })
		.from(ballotElector)
		.where(and(eq(ballotElector.ballotId, ballotId), eq(ballotElector.userId, userId)))
		.limit(1);
	return Boolean(row);
}

/** On a secret ballot the answer is only whether they voted; `optionId` is always null. */
export async function getMyVote(
	ballotId: string,
	userId: string
): Promise<{ voted: boolean; optionId: string | null }> {
	const b = await getBallot(ballotId);
	if (b.kind === 'member') {
		const [row] = await db
			.select({ userId: ballotParticipation.userId })
			.from(ballotParticipation)
			.where(
				and(eq(ballotParticipation.ballotId, ballotId), eq(ballotParticipation.userId, userId))
			)
			.limit(1);
		return { voted: Boolean(row), optionId: null };
	}
	const [row] = await db
		.select({ optionId: ballotRecordedVote.optionId })
		.from(ballotRecordedVote)
		.where(and(eq(ballotRecordedVote.ballotId, ballotId), eq(ballotRecordedVote.userId, userId)))
		.limit(1);
	return { voted: Boolean(row), optionId: row?.optionId ?? null };
}

async function countVoted(b: Pick<Ballot, 'id' | 'kind'>): Promise<number> {
	const table = b.kind === 'member' ? ballotParticipation : ballotRecordedVote;
	const [row] = await db.select({ n: count() }).from(table).where(eq(table.ballotId, b.id));
	return row?.n ?? 0;
}

/** How many have voted. Says nothing about direction, so it is readable while open. */
export async function getTurnout(
	ballotId: string
): Promise<{ voted: number; electorateSize: number }> {
	const b = await getBallot(ballotId);
	return { voted: await countVoted(b), electorateSize: b.electorateSize ?? 0 };
}

export interface BallotTally {
	options: BallotCertifiedResult['options'];
	turnout: number;
	electorateSize: number;
	/** Recorded ballots only: who voted which way. Null on a secret ballot. */
	rollCall: Array<{ userId: string; name: string; optionId: string }> | null;
}

/** Refused until the close, to everyone. A cancelled ballot never has a result. */
export async function getTally(ballotId: string, opts: { now?: Date } = {}): Promise<BallotTally> {
	const b = await getBallot(ballotId);
	const status = ballotStatusOf(b, opts.now);
	if (status !== 'closed' && status !== 'certified') throw new TallyHiddenError();

	const rollCall = b.kind === 'group' ? await listRollCall(b.id) : null;
	if (b.certifiedResult) return { ...b.certifiedResult, rollCall };

	return { ...(await computeResult(b)), rollCall };
}

async function computeResult(b: Ballot): Promise<BallotCertifiedResult> {
	const options = await db
		.select({ optionId: ballotOption.id, label: ballotOption.label })
		.from(ballotOption)
		.where(eq(ballotOption.ballotId, b.id))
		.orderBy(asc(ballotOption.position));

	const counts = new Map<string, number>();
	if (b.kind === 'member') {
		const rows = await db
			.select({ optionId: ballotChoice.optionId, votes: ballotChoice.votes })
			.from(ballotChoice)
			.where(eq(ballotChoice.ballotId, b.id));
		for (const r of rows) counts.set(r.optionId, r.votes);
	} else {
		const rows = await db
			.select({ optionId: ballotRecordedVote.optionId, votes: count() })
			.from(ballotRecordedVote)
			.where(eq(ballotRecordedVote.ballotId, b.id))
			.groupBy(ballotRecordedVote.optionId);
		for (const r of rows) counts.set(r.optionId, r.votes);
	}

	return {
		options: options.map((o) => ({ ...o, votes: counts.get(o.optionId) ?? 0 })),
		turnout: await countVoted(b),
		electorateSize: b.electorateSize ?? 0
	};
}

async function listRollCall(ballotId: string) {
	return db
		.select({
			userId: ballotRecordedVote.userId,
			name: user.name,
			optionId: ballotRecordedVote.optionId
		})
		.from(ballotRecordedVote)
		.innerJoin(user, eq(user.id, ballotRecordedVote.userId))
		.where(eq(ballotRecordedVote.ballotId, ballotId))
		.orderBy(asc(user.name), asc(user.id));
}

export interface BallotSummary {
	id: string;
	kind: BallotKind;
	title: string;
	status: BallotStatus;
	closesAt: Date;
	groupName: string | null;
	isElector: boolean;
	hasVoted: boolean;
	isCertifier: boolean;
}

/**
 * What a member sees on `/member/ballots`: ballots they are on the roll for,
 * ballots they must certify, and every certified result. Drafts appear only
 * through `managedGroupIds`, the committees the caller administers.
 */
export async function listBallotsForMember(
	userId: string,
	opts: { now?: Date; managedGroupIds?: string[] } = {}
): Promise<BallotSummary[]> {
	const now = opts.now ?? new Date();
	const elector = db
		.select({ x: sql`1` })
		.from(ballotElector)
		.where(and(eq(ballotElector.ballotId, ballot.id), eq(ballotElector.userId, userId)));
	const participated = db
		.select({ x: sql`1` })
		.from(ballotParticipation)
		.where(
			and(eq(ballotParticipation.ballotId, ballot.id), eq(ballotParticipation.userId, userId))
		);
	const recorded = db
		.select({ x: sql`1` })
		.from(ballotRecordedVote)
		.where(and(eq(ballotRecordedVote.ballotId, ballot.id), eq(ballotRecordedVote.userId, userId)));

	const managed = opts.managedGroupIds?.length
		? inArray(ballot.groupId, opts.managedGroupIds)
		: undefined;

	const rows = await db
		.select({
			ballot,
			groupName: group.name,
			isElector: sql<number>`exists (${elector})`,
			hasVoted: sql<number>`(exists (${participated}) or exists (${recorded}))`
		})
		.from(ballot)
		.leftJoin(group, eq(group.id, ballot.groupId))
		.where(
			or(exists(elector), eq(ballot.certifierId, userId), isNotNull(ballot.certifiedAt), managed)
		)
		.orderBy(desc(ballot.closesAt), asc(ballot.id));

	return rows.map((r) => toSummary(r.ballot, r.groupName, now, userId, r.isElector, r.hasVoted));
}

function toSummary(
	b: Ballot,
	groupName: string | null,
	now: Date,
	userId: string | null,
	isElectorFlag: number | boolean,
	hasVotedFlag: number | boolean
): BallotSummary {
	return {
		id: b.id,
		kind: b.kind,
		title: b.title,
		status: ballotStatusOf(b, now),
		closesAt: b.closesAt,
		groupName,
		isElector: Boolean(isElectorFlag),
		hasVoted: Boolean(hasVotedFlag),
		isCertifier: userId !== null && b.certifierId === userId
	};
}

/** Every ballot, for staff. */
export async function listAllBallots(opts: { now?: Date } = {}): Promise<BallotSummary[]> {
	const now = opts.now ?? new Date();
	const rows = await db
		.select({ ballot, groupName: group.name })
		.from(ballot)
		.leftJoin(group, eq(group.id, ballot.groupId))
		.orderBy(desc(ballot.createdAt), asc(ballot.id));
	return rows.map((r) => toSummary(r.ballot, r.groupName, now, null, false, false));
}

export async function listOverrides(ballotId: string) {
	return db
		.select({
			userId: ballotElectorOverride.userId,
			name: user.name,
			include: ballotElectorOverride.include,
			reason: ballotElectorOverride.reason,
			createdAt: ballotElectorOverride.createdAt
		})
		.from(ballotElectorOverride)
		.innerJoin(user, eq(user.id, ballotElectorOverride.userId))
		.where(eq(ballotElectorOverride.ballotId, ballotId))
		.orderBy(asc(user.name), asc(user.id));
}

// ---------------------------------------------------------------------------
// Electorate
// ---------------------------------------------------------------------------

const activeAccount = and(isNull(user.deletedAt), isNull(user.bannedAt));

function overrideExists(ballotId: string, include: boolean) {
	return exists(
		db
			.select({ x: sql`1` })
			.from(ballotElectorOverride)
			.where(
				and(
					eq(ballotElectorOverride.ballotId, ballotId),
					eq(ballotElectorOverride.userId, user.id),
					eq(ballotElectorOverride.include, include)
				)
			)
	);
}

/** Members of record at `cutoff`, with this ballot's overrides applied. */
function memberOfRecordWhere(ballotId: string, cutoff: Date) {
	const oriented = exists(
		db
			.select({ x: sql`1` })
			.from(memberOrientation)
			.where(
				and(
					eq(memberOrientation.userId, user.id),
					or(isNotNull(memberOrientation.completedAt), isNotNull(memberOrientation.waivedAt))
				)
			)
	);
	return and(
		activeAccount,
		or(
			and(lte(user.createdAt, cutoff), oriented, sql`not ${overrideExists(ballotId, false)}`),
			overrideExists(ballotId, true)
		)
	);
}

async function memberOfRecordCutoff(now: Date): Promise<Date> {
	const days = Number(await config('ballot.memberOfRecordDays'));
	return new Date(now.getTime() - days * 86_400_000);
}

/** How many the roll would hold if the draft opened now. */
export async function previewElectorateSize(ballotId: string, opts: { now?: Date } = {}) {
	const b = await getBallot(ballotId);
	if (b.kind === 'group') {
		const [row] = await db
			.select({ n: count() })
			.from(groupMember)
			.innerJoin(user, eq(user.id, groupMember.userId))
			.where(
				and(eq(groupMember.groupId, b.groupId!), eq(groupMember.status, 'active'), activeAccount)
			);
		return row?.n ?? 0;
	}
	const cutoff = await memberOfRecordCutoff(opts.now ?? new Date());
	const [row] = await db.select({ n: count() }).from(user).where(memberOfRecordWhere(b.id, cutoff));
	return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface BallotInput {
	kind: BallotKind;
	groupId?: string | null;
	title: string;
	description?: string | null;
	options: string[];
	closesAt: Date;
	certifierId: string;
}

type Ctx = { actorId: string; now?: Date };

async function validate(input: Omit<BallotInput, 'kind' | 'groupId'>, now: Date) {
	const title = input.title.trim();
	if (!title || title.length > BALLOT_TITLE_MAX) {
		throw new BallotValidationError('A ballot needs a question of up to 200 characters');
	}
	const description = input.description?.trim() || null;
	if (description && description.length > BALLOT_DESCRIPTION_MAX) {
		throw new BallotValidationError('The description is too long');
	}
	const options = input.options.map((o) => o.trim()).filter(Boolean);
	const distinct = new Set(options.map((o) => o.toLowerCase()));
	if (
		distinct.size !== options.length ||
		options.length < BALLOT_OPTIONS_MIN ||
		options.length > BALLOT_OPTIONS_MAX ||
		options.some((o) => o.length > BALLOT_OPTION_LABEL_MAX)
	) {
		throw new BallotValidationError('A ballot needs between 2 and 10 different choices');
	}
	if (input.closesAt.getTime() <= now.getTime()) {
		throw new BallotValidationError('The close date must be in the future');
	}
	const [certifier] = await db
		.select({ id: user.id })
		.from(user)
		.where(and(eq(user.id, input.certifierId), activeAccount))
		.limit(1);
	if (!certifier) throw new BallotValidationError('The certifier must be an active account');
	return { title, description, options, closesAt: input.closesAt, certifierId: input.certifierId };
}

export async function createBallot(input: BallotInput, ctx: Ctx): Promise<string> {
	const now = ctx.now ?? new Date();
	const clean = await validate(input, now);

	let groupId: string | null = null;
	if (input.kind === 'group') {
		const [g] = await db
			.select({ id: group.id, kind: group.kind })
			.from(group)
			.where(and(eq(group.id, input.groupId ?? ''), isNull(group.deletedAt)))
			.limit(1);
		if (g?.kind !== 'committee') {
			throw new BallotValidationError('A group ballot belongs to a committee');
		}
		groupId = g.id;
	}

	const id = crypto.randomUUID();
	await db.batch([
		db.insert(ballot).values({
			id,
			kind: input.kind,
			groupId,
			title: clean.title,
			description: clean.description,
			closesAt: clean.closesAt,
			certifierId: clean.certifierId,
			createdById: ctx.actorId
		}),
		db
			.insert(ballotOption)
			.values(clean.options.map((label, position) => ({ ballotId: id, label, position })))
	]);
	return id;
}

function requireStatus(b: Ballot, now: Date, allowed: BallotStatus[], message: string) {
	if (!allowed.includes(ballotStatusOf(b, now))) throw new BallotStateError(message);
}

/** Replaces the question, choices, close date and certifier. Drafts only. */
export async function updateDraft(
	ballotId: string,
	input: Omit<BallotInput, 'kind' | 'groupId'>,
	ctx: { now?: Date } = {}
): Promise<void> {
	const now = ctx.now ?? new Date();
	const b = await getBallot(ballotId);
	requireStatus(b, now, ['draft'], 'Only a draft can be edited');
	const clean = await validate(input, now);

	await db.batch([
		db
			.update(ballot)
			.set({
				title: clean.title,
				description: clean.description,
				closesAt: clean.closesAt,
				certifierId: clean.certifierId,
				updatedAt: now
			})
			.where(and(eq(ballot.id, ballotId), isNull(ballot.openedAt))),
		db.delete(ballotOption).where(eq(ballotOption.ballotId, ballotId)),
		db
			.insert(ballotOption)
			.values(clean.options.map((label, position) => ({ ballotId, label, position })))
	]);
}

/** Name someone else to certify. Allowed until the result is certified. */
export async function setCertifier(
	ballotId: string,
	certifierId: string,
	ctx: { now?: Date } = {}
): Promise<void> {
	const now = ctx.now ?? new Date();
	const b = await getBallot(ballotId);
	requireStatus(b, now, ['draft', 'open', 'closed'], 'The certifier can no longer be changed');
	const [certifier] = await db
		.select({ id: user.id })
		.from(user)
		.where(and(eq(user.id, certifierId), activeAccount))
		.limit(1);
	if (!certifier) throw new BallotValidationError('The certifier must be an active account');
	await db.update(ballot).set({ certifierId, updatedAt: now }).where(eq(ballot.id, ballotId));
}

/**
 * Freeze the roll and start voting. One batch: the conditional stamp, the
 * `INSERT … SELECT` of the roll, the counters, and the roll's size. A second
 * concurrent open collides on the roll's primary key and rolls back whole.
 */
export async function openBallot(ballotId: string, ctx: { now?: Date } = {}): Promise<void> {
	const now = ctx.now ?? new Date();
	const b = await getBallot(ballotId);
	requireStatus(b, now, ['draft'], 'This ballot has already been opened');
	if (b.closesAt.getTime() <= now.getTime()) {
		throw new BallotStateError('The close date has passed; set a new one first');
	}
	if (!b.certifierId) throw new BallotStateError('Name a certifier first');

	const options = await db
		.select({ id: ballotOption.id })
		.from(ballotOption)
		.where(eq(ballotOption.ballotId, ballotId));
	if (options.length < BALLOT_OPTIONS_MIN) throw new BallotStateError('Add at least two choices');

	const electors =
		b.kind === 'group'
			? db
					.select({
						ballotId: sql<string>`${ballotId}`.as('ballot_id'),
						userId: groupMember.userId
					})
					.from(groupMember)
					.innerJoin(user, eq(user.id, groupMember.userId))
					.where(
						and(
							eq(groupMember.groupId, b.groupId!),
							eq(groupMember.status, 'active'),
							activeAccount
						)
					)
			: db
					.select({ ballotId: sql<string>`${ballotId}`.as('ballot_id'), userId: user.id })
					.from(user)
					.where(memberOfRecordWhere(ballotId, await memberOfRecordCutoff(now)));

	await db.batch([
		db
			.update(ballot)
			.set({ openedAt: now, updatedAt: now })
			.where(and(eq(ballot.id, ballotId), isNull(ballot.openedAt))),
		db.insert(ballotElector).select(electors),
		...(b.kind === 'member'
			? [db.insert(ballotChoice).values(options.map((o) => ({ ballotId, optionId: o.id })))]
			: []),
		refreshElectorateSize(ballotId)
	]);

	await domainEvents.emit('ballot.opened', { ballotId, title: b.title });
}

function refreshElectorateSize(ballotId: string) {
	return db
		.update(ballot)
		.set({
			electorateSize: sql`(select count(*) from ${ballotElector} where ${ballotElector.ballotId} = ${ballotId})`
		})
		.where(eq(ballot.id, ballotId));
}

/**
 * Put one member on, or take them off, a member-wide roll. On a draft this is
 * applied at open; on an open ballot it changes the frozen roll now, except that
 * nobody who has voted can be removed: a secret vote cannot be withdrawn.
 */
export async function setElectorOverride(
	ballotId: string,
	input: { userId: string; include: boolean; reason: string },
	ctx: Ctx
): Promise<void> {
	const now = ctx.now ?? new Date();
	const b = await getBallot(ballotId);
	if (b.kind !== 'member') {
		throw new BallotValidationError('A committee ballot’s roll is its roster');
	}
	requireStatus(b, now, ['draft', 'open'], 'The roll can no longer be changed');
	const reason = input.reason.trim();
	if (!reason || reason.length > BALLOT_REASON_MAX) {
		throw new BallotValidationError('Say why, in up to 500 characters');
	}

	const [member] = await db
		.select({ id: user.id, name: user.name, active: sql<number>`${activeAccount}` })
		.from(user)
		.where(eq(user.id, input.userId))
		.limit(1);
	if (!member) throw new BallotValidationError('No such member');

	const isOpen = ballotStatusOf(b, now) === 'open';
	if (isOpen && !input.include) {
		const { voted } = await getMyVote(ballotId, input.userId);
		if (voted)
			throw new BallotStateError('They have already voted, and a secret vote cannot be withdrawn');
	}

	const upsert = db
		.insert(ballotElectorOverride)
		.values({
			ballotId,
			userId: input.userId,
			include: input.include,
			reason,
			createdById: ctx.actorId,
			createdAt: now
		})
		.onConflictDoUpdate({
			target: [ballotElectorOverride.ballotId, ballotElectorOverride.userId],
			set: { include: input.include, reason, createdById: ctx.actorId, createdAt: now }
		});

	if (!isOpen) {
		await upsert;
	} else if (input.include) {
		if (!member.active) throw new BallotValidationError('Only an active account can vote');
		await db.batch([
			upsert,
			db.insert(ballotElector).values({ ballotId, userId: input.userId }).onConflictDoNothing(),
			refreshElectorateSize(ballotId)
		]);
	} else {
		await db.batch([
			upsert,
			db
				.delete(ballotElector)
				.where(and(eq(ballotElector.ballotId, ballotId), eq(ballotElector.userId, input.userId))),
			refreshElectorateSize(ballotId)
		]);
	}

	await recordAuditEntry({
		action: 'ballot.elector_overridden',
		subject: { type: 'user', id: member.id, label: member.name },
		details: { ballotId, ballotTitle: b.title, include: input.include, reason }
	});
}

/**
 * Cast or change a vote. The option id goes to the counter update and nowhere
 * else: never into a log, an error, or an event (see the spec's limits).
 */
export async function castVote(
	ballotId: string,
	userId: string,
	optionId: string,
	ctx: { now?: Date } = {}
): Promise<void> {
	const now = ctx.now ?? new Date();
	const b = await getBallot(ballotId);
	requireStatus(b, now, ['open'], 'This ballot is not open for voting');
	if (!(await isElector(ballotId, userId))) throw new NotAnElectorError();

	const [option] = await db
		.select({ id: ballotOption.id })
		.from(ballotOption)
		.where(and(eq(ballotOption.id, optionId), eq(ballotOption.ballotId, ballotId)))
		.limit(1);
	if (!option) throw new BallotValidationError('That is not one of this ballot’s choices');

	if (b.kind === 'group') {
		await db
			.insert(ballotRecordedVote)
			.values({ ballotId, userId, optionId, updatedAt: now })
			.onConflictDoUpdate({
				target: [ballotRecordedVote.ballotId, ballotRecordedVote.userId],
				set: { optionId, updatedAt: now }
			});
		return;
	}

	if ((await getMyVote(ballotId, userId)).voted) throw new AlreadyVotedError();
	try {
		await db.batch([
			db.insert(ballotParticipation).values({ ballotId, userId }),
			db
				.update(ballotChoice)
				.set({ votes: sql`${ballotChoice.votes} + 1` })
				.where(and(eq(ballotChoice.ballotId, ballotId), eq(ballotChoice.optionId, optionId)))
		]);
	} catch (err) {
		if (/UNIQUE|PRIMARY KEY/i.test(String((err as Error)?.message ?? err))) {
			throw new AlreadyVotedError();
		}
		throw err;
	}
}

/** Fix the result and publish it. Only the named certifier, only after the close. */
export async function certifyBallot(
	ballotId: string,
	userId: string,
	ctx: { now?: Date } = {}
): Promise<void> {
	const now = ctx.now ?? new Date();
	const b = await getBallot(ballotId);
	requireStatus(b, now, ['closed'], 'Only a closed, uncertified ballot can be certified');
	if (b.certifierId !== userId) throw new NotCertifierError();

	const result = await computeResult(b);
	const stamped = await db
		.update(ballot)
		.set({ certifiedAt: now, certifiedById: userId, certifiedResult: result, updatedAt: now })
		.where(and(eq(ballot.id, ballotId), isNull(ballot.certifiedAt), isNull(ballot.cancelledAt)))
		.returning({ id: ballot.id });
	if (stamped.length === 0) throw new BallotStateError('This ballot has already been certified');

	await domainEvents.emit('ballot.certified', { ballotId, title: b.title });
}

export async function cancelBallot(
	ballotId: string,
	reason: string,
	ctx: { now?: Date } = {}
): Promise<void> {
	const now = ctx.now ?? new Date();
	const b = await getBallot(ballotId);
	requireStatus(b, now, ['draft', 'open', 'closed'], 'A certified ballot cannot be cancelled');
	const clean = reason.trim();
	if (!clean || clean.length > BALLOT_REASON_MAX) {
		throw new BallotValidationError('Say why, in up to 500 characters');
	}
	await db
		.update(ballot)
		.set({ cancelledAt: now, cancelReason: clean, updatedAt: now })
		.where(and(eq(ballot.id, ballotId), isNull(ballot.certifiedAt), isNull(ballot.cancelledAt)));
}
