import { db } from '$lib/server/db';
import { moderationAppeal } from '$lib/server/db/schema/moderation';
import { contentFlag, type FlagEntityType, type FlagOrigin } from '$lib/server/db/schema/flag';
import { memberStanding } from '$lib/server/db/schema/standing';
import { suggestion } from '$lib/server/db/schema/suggestion';
import { eventListing } from '$lib/server/db/schema/event';
import { user } from '$lib/server/db/schema/authentication';
import { and, count, desc, eq, isNull, ne } from 'drizzle-orm';
import {
	APPEAL_BODY_MAX,
	appealVerdict,
	type AppealOutcome,
	type AppealVerdict,
	type StandingScope
} from '$lib/config';
import { DomainError } from '$lib/server/domain-error';
import { domainEvents } from '$lib/server/event-bus/event-bus';
import { captureException } from '$lib/server/sentry';
import { restoreStanding } from './standing-service';

// The rules are argued in docs/specs/shipped/moderation-appeals-spec.md. Appeals
// contest an upheld report and nothing else — never an account action.

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** 404, not 403: a member probing someone else's decision learns nothing. */
export class AppealNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('There is no decision here to appeal');
		this.name = 'AppealNotFoundError';
	}
}

export class AppealAlreadyFiledError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('You have already appealed this decision');
		this.name = 'AppealAlreadyFiledError';
	}
}

export class AppealAlreadyDecidedError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('This appeal has already been decided — reopen it first');
		this.name = 'AppealAlreadyDecidedError';
	}
}

export class AppealNotDecidedError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('This appeal is still pending');
		this.name = 'AppealNotDecidedError';
	}
}

export class SelfReviewError extends DomainError {
	readonly httpStatus = 403;
	constructor() {
		super('You upheld this report, so a different staffer has to deny the appeal against it');
		this.name = 'SelfReviewError';
	}
}

// ---------------------------------------------------------------------------
// Targets — what the member is looking at, never a flag id
// ---------------------------------------------------------------------------

export type AppealTarget =
	| { kind: 'suggestion'; suggestionId: string }
	| { kind: 'listing'; eventId: string }
	| { kind: 'standing'; scope: StandingScope };

interface AppealableFlag {
	id: string;
	entityType: FlagEntityType;
	entityId: string;
	origin: FlagOrigin;
	resolutionNotes: string | null;
	resolvedAt: Date | null;
	resolvedByUserId: string | null;
}

const flagColumns = {
	id: contentFlag.id,
	entityType: contentFlag.entityType,
	entityId: contentFlag.entityId,
	origin: contentFlag.origin,
	resolutionNotes: contentFlag.resolutionNotes,
	resolvedAt: contentFlag.resolvedAt,
	resolvedByUserId: contentFlag.resolvedByUserId
};

async function latestUpheldFlag(
	entityType: FlagEntityType,
	entityId: string
): Promise<AppealableFlag | null> {
	const [row] = await db
		.select(flagColumns)
		.from(contentFlag)
		.where(
			and(
				eq(contentFlag.entityType, entityType),
				eq(contentFlag.entityId, entityId),
				eq(contentFlag.status, 'resolved')
			)
		)
		.orderBy(desc(contentFlag.resolvedAt))
		.limit(1);
	return row ?? null;
}

/**
 * The upheld report behind what this member is looking at, or null when there
 * is none or it is not theirs. Ownership is checked before any flag is read.
 */
async function appealableFlagFor(
	userId: string,
	target: AppealTarget
): Promise<AppealableFlag | null> {
	switch (target.kind) {
		case 'suggestion': {
			const [row] = await db
				.select({ authorUserId: suggestion.authorUserId })
				.from(suggestion)
				.where(eq(suggestion.id, target.suggestionId))
				.limit(1);
			if (!row || row.authorUserId !== userId) return null;
			return latestUpheldFlag('suggestion', target.suggestionId);
		}
		case 'listing': {
			const [row] = await db
				.select({ createdByUserId: eventListing.createdByUserId, source: eventListing.source })
				.from(eventListing)
				.where(eq(eventListing.id, target.eventId))
				.limit(1);
			if (!row || row.createdByUserId !== userId || row.source !== 'community') return null;
			return latestUpheldFlag('event', target.eventId);
		}
		case 'standing': {
			// Only a standing still in force: a restored one has nothing left to contest.
			const [row] = await db
				.select({
					status: memberStanding.status,
					triggeringFlagId: memberStanding.triggeringFlagId
				})
				.from(memberStanding)
				.where(and(eq(memberStanding.userId, userId), eq(memberStanding.scope, target.scope)))
				.limit(1);
			if (!row || row.status === 'none' || !row.triggeringFlagId) return null;
			const [flag] = await db
				.select(flagColumns)
				.from(contentFlag)
				.where(and(eq(contentFlag.id, row.triggeringFlagId), eq(contentFlag.status, 'resolved')))
				.limit(1);
			return flag ?? null;
		}
	}
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface AppealDecision {
	contentOutcome: AppealOutcome;
	standingOutcome: AppealOutcome;
	verdict: AppealVerdict;
	notes: string | null;
	decidedAt: Date;
}

/** The member sees the verdict only; the staffer's reason stays internal (#1430). */
export type MemberAppealDecision = Omit<AppealDecision, 'notes'>;

export interface MemberAppealView {
	/** The decision being contested, as the member was told it. */
	upheld: { notes: string | null; resolvedAt: Date | null; byStaff: boolean };
	appeal: { body: string; createdAt: Date; decision: MemberAppealDecision | null } | null;
}

function memberDecisionOf(row: Parameters<typeof decisionOf>[0]): MemberAppealDecision | null {
	const decision = decisionOf(row);
	if (!decision) return null;
	const { contentOutcome, standingOutcome, verdict, decidedAt } = decision;
	return { contentOutcome, standingOutcome, verdict, decidedAt };
}

function decisionOf(row: {
	contentOutcome: AppealOutcome | null;
	standingOutcome: AppealOutcome | null;
	decisionNotes: string | null;
	decidedAt: Date | null;
}): AppealDecision | null {
	if (!row.decidedAt) return null;
	const content = row.contentOutcome ?? 'not_applicable';
	const standing = row.standingOutcome ?? 'not_applicable';
	return {
		contentOutcome: content,
		standingOutcome: standing,
		verdict: appealVerdict(content, standing),
		notes: row.decisionNotes,
		decidedAt: row.decidedAt
	};
}

/** Null when there is nothing this member could appeal here. */
export async function getMemberAppeal(
	userId: string,
	target: AppealTarget
): Promise<MemberAppealView | null> {
	const flag = await appealableFlagFor(userId, target);
	if (!flag) return null;

	const [appeal] = await db
		.select()
		.from(moderationAppeal)
		.where(eq(moderationAppeal.flagId, flag.id))
		.limit(1);

	return {
		upheld: {
			notes: flag.resolutionNotes,
			resolvedAt: flag.resolvedAt,
			byStaff: flag.origin === 'staff_action'
		},
		appeal: appeal
			? { body: appeal.body, createdAt: appeal.createdAt, decision: memberDecisionOf(appeal) }
			: null
	};
}

export interface StaffAppealView {
	body: string;
	createdAt: Date;
	appellantUserId: string | null;
	appellantName: string | null;
	decision: AppealDecision | null;
	/** Whether each consequence is still in force — what the decide form can offer. */
	contentApplicable: boolean;
	standingApplicable: boolean;
	/** False for the staffer who upheld the report. They may still grant. */
	canDeny: boolean;
}

export async function getAppealForFlag(
	flagId: string,
	viewerId: string
): Promise<StaffAppealView | null> {
	const [row] = await db
		.select({
			appeal: moderationAppeal,
			appellantName: user.name,
			resolvedByUserId: contentFlag.resolvedByUserId,
			entityType: contentFlag.entityType,
			entityId: contentFlag.entityId
		})
		.from(moderationAppeal)
		.innerJoin(contentFlag, eq(contentFlag.id, moderationAppeal.flagId))
		.leftJoin(user, eq(user.id, moderationAppeal.appellantUserId))
		.where(eq(moderationAppeal.flagId, flagId))
		.limit(1);
	if (!row) return null;

	const consequences = await consequencesOf({
		id: flagId,
		entityType: row.entityType,
		entityId: row.entityId
	});

	return {
		body: row.appeal.body,
		createdAt: row.appeal.createdAt,
		appellantUserId: row.appeal.appellantUserId,
		appellantName: row.appellantName,
		decision: decisionOf(row.appeal),
		contentApplicable: consequences.content,
		standingApplicable: consequences.standings.length > 0,
		canDeny: row.resolvedByUserId !== viewerId
	};
}

export async function countPendingAppeals(): Promise<number> {
	const [row] = await db
		.select({ count: count() })
		.from(moderationAppeal)
		.where(isNull(moderationAppeal.decidedAt));
	return row?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Consequences — read from actual state, never from the form
// ---------------------------------------------------------------------------

interface Consequences {
	/** The content is still down because of this report. */
	content: boolean;
	/** Standings this report is still the reason for. */
	standings: { userId: string; scope: StandingScope }[];
}

async function consequencesOf(flag: {
	id: string;
	entityType: FlagEntityType;
	entityId: string;
}): Promise<Consequences> {
	let content = false;
	if (flag.entityType === 'suggestion') {
		const [row] = await db
			.select({ visibility: suggestion.visibility })
			.from(suggestion)
			.where(eq(suggestion.id, flag.entityId))
			.limit(1);
		content = row?.visibility === 'hidden';
	} else if (flag.entityType === 'event') {
		const [row] = await db
			.select({ status: eventListing.status, source: eventListing.source })
			.from(eventListing)
			.where(eq(eventListing.id, flag.entityId))
			.limit(1);
		content =
			row?.source === 'community' && (row.status === 'draft' || row.status === 'pending_review');
	}

	// A later report re-pointing the standing owns it now, and its own appeal
	// decides it — so only rows still naming this flag count.
	const standings = await db
		.select({ userId: memberStanding.userId, scope: memberStanding.scope })
		.from(memberStanding)
		.where(and(eq(memberStanding.triggeringFlagId, flag.id), ne(memberStanding.status, 'none')));

	return { content, standings };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function isUniqueViolation(err: unknown): boolean {
	return err instanceof Error && /UNIQUE constraint failed/i.test(err.message);
}

export async function fileAppeal(params: {
	userId: string;
	userName: string;
	target: AppealTarget;
	body: string;
}): Promise<{ id: string }> {
	const flag = await appealableFlagFor(params.userId, params.target);
	if (!flag) throw new AppealNotFoundError();

	const [existing] = await db
		.select({ id: moderationAppeal.id })
		.from(moderationAppeal)
		.where(eq(moderationAppeal.flagId, flag.id))
		.limit(1);
	if (existing) throw new AppealAlreadyFiledError();

	let row: { id: string };
	try {
		[row] = await db
			.insert(moderationAppeal)
			.values({
				flagId: flag.id,
				appellantUserId: params.userId,
				body: params.body.trim().slice(0, APPEAL_BODY_MAX)
			})
			.returning();
	} catch (err) {
		if (isUniqueViolation(err)) throw new AppealAlreadyFiledError();
		throw err;
	}

	try {
		await domainEvents.emit('moderation.appeal_filed', {
			flagId: flag.id,
			appellantName: params.userName
		});
	} catch (err) {
		captureException(err, { event: 'moderation.appeal_filed', flagId: flag.id });
	}

	return { id: row.id };
}

export interface DecideAppealParams {
	flagId: string;
	staffId: string;
	restoreContent: boolean;
	restoreStanding: boolean;
	notes: string;
}

/**
 * Answer an appeal. Effects first, stamp last: both restores are idempotent, so
 * a crash between steps leaves the appeal pending and a second click repairs it.
 * The reverse order could show "granted" over a member still restricted.
 */
export async function decideAppeal(
	params: DecideAppealParams
): Promise<{ contentOutcome: AppealOutcome; standingOutcome: AppealOutcome }> {
	const [appeal] = await db
		.select({
			id: moderationAppeal.id,
			appellantUserId: moderationAppeal.appellantUserId,
			decidedAt: moderationAppeal.decidedAt
		})
		.from(moderationAppeal)
		.where(eq(moderationAppeal.flagId, params.flagId))
		.limit(1);
	if (!appeal) throw new AppealNotFoundError();
	if (appeal.decidedAt) throw new AppealAlreadyDecidedError();

	const [flag] = await db
		.select(flagColumns)
		.from(contentFlag)
		.where(eq(contentFlag.id, params.flagId))
		.limit(1);
	if (!flag) throw new AppealNotFoundError();

	const consequences = await consequencesOf(flag);
	const contentOutcome: AppealOutcome = consequences.content
		? params.restoreContent
			? 'restored'
			: 'upheld'
		: 'not_applicable';
	const standingOutcome: AppealOutcome =
		consequences.standings.length > 0
			? params.restoreStanding
				? 'restored'
				: 'upheld'
			: 'not_applicable';
	const verdict = appealVerdict(contentOutcome, standingOutcome);

	// You may overturn yourself; you may not ratify yourself.
	if (verdict === 'denied' && flag.resolvedByUserId === params.staffId) {
		throw new SelfReviewError();
	}

	if (standingOutcome === 'restored') {
		for (const s of consequences.standings) {
			await restoreStanding({ userId: s.userId, scope: s.scope, staffId: params.staffId });
		}
	}

	if (contentOutcome === 'restored') {
		if (flag.entityType === 'suggestion') {
			const { setVisibility } = await import('$lib/server/suggestion/suggestion-service');
			await setVisibility(flag.entityId, {
				visibility: 'visible',
				note: params.notes,
				staffId: params.staffId
			});
		} else if (flag.entityType === 'event') {
			// Directly, not through the standing-aware submit: a staffer has just
			// decided this listing should be public, so it must not queue again.
			const { publish } = await import('$lib/server/event/event-service');
			await publish(flag.entityId);
		}
	}

	const notes = params.notes.trim();
	await db
		.update(moderationAppeal)
		.set({
			contentOutcome,
			standingOutcome,
			decisionNotes: notes || null,
			decidedByUserId: params.staffId,
			decidedAt: new Date()
		})
		.where(and(eq(moderationAppeal.id, appeal.id), isNull(moderationAppeal.decidedAt)));

	await notifyAppellant(appeal.appellantUserId, flag, consequences, verdict);

	return { contentOutcome, standingOutcome };
}

/** Where the member reads the decision: the page the appeal was filed from. */
function memberHrefFor(flag: AppealableFlag, consequences: Consequences): string {
	if (flag.entityType === 'suggestion') return `/member/suggestions/${flag.entityId}`;
	if (flag.entityType === 'event') return `/member/events/${flag.entityId}/manage`;
	switch (consequences.standings[0]?.scope) {
		case 'suggestion':
			return '/member/suggestions';
		case 'community_event':
			return '/member/events';
		default:
			return '/member/account';
	}
}

async function notifyAppellant(
	appellantUserId: string | null,
	flag: AppealableFlag,
	consequences: Consequences,
	verdict: AppealVerdict
): Promise<void> {
	if (!appellantUserId) return;
	try {
		const [member] = await db
			.select({ name: user.name, email: user.email })
			.from(user)
			.where(eq(user.id, appellantUserId))
			.limit(1);
		if (!member) return;
		await domainEvents.emit('moderation.appeal_decided', {
			flagId: flag.id,
			appellantUserId,
			appellantName: member.name,
			appellantEmail: member.email,
			verdict,
			href: memberHrefFor(flag, consequences)
		});
	} catch (err) {
		captureException(err, { event: 'moderation.appeal_decided', flagId: flag.id });
	}
}

/**
 * Put a decided appeal back in the queue. Staff only — a member cannot ask for
 * this, which keeps "one appeal per decision" honest. Effects already applied
 * stay applied; reopening reconsiders, it does not undo.
 */
export async function reopenAppeal(params: { flagId: string }): Promise<void> {
	const [appeal] = await db
		.select({ id: moderationAppeal.id, decidedAt: moderationAppeal.decidedAt })
		.from(moderationAppeal)
		.where(eq(moderationAppeal.flagId, params.flagId))
		.limit(1);
	if (!appeal) throw new AppealNotFoundError();
	if (!appeal.decidedAt) throw new AppealNotDecidedError();

	await db
		.update(moderationAppeal)
		.set({
			decidedAt: null,
			decidedByUserId: null,
			contentOutcome: null,
			standingOutcome: null,
			decisionNotes: null
		})
		.where(eq(moderationAppeal.id, appeal.id));
}
