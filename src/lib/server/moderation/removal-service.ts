import { and, desc, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db } from '#lib/server/db/index.js';
import { isUniqueConstraintError } from '#lib/server/db/constraint-errors.js';
import {
	accountRemoval,
	type AccountRemoval,
	type RemovalLedger
} from '#lib/server/db/schema/moderation.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { DomainError } from '#lib/server/domain-error.js';
import { STANDING_REASON_MAX, type RemovalKind, type RemovalLiftReason } from '#lib/config.js';

export class RemovalAlreadyOpenError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('This account already has an open removal');
	}
}

export class RemovalWithoutReportError extends DomainError {
	readonly httpStatus = 400;
	constructor() {
		super('A removal needs the report it rests on');
	}
}

/**
 * Stamp the record of a removal whose side effects have already run. The
 * partial unique index refuses a second open row, which is what stops two
 * staffers removing the same member at once from writing two records.
 */
export async function recordRemoval(params: {
	userId: string;
	actorUserId: string;
	kind: RemovalKind;
	reason: string;
	flagId: string;
	endsAt?: Date | null;
	ledger: RemovalLedger;
}): Promise<AccountRemoval> {
	if (!params.flagId) throw new RemovalWithoutReportError();
	try {
		const [row] = await db
			.insert(accountRemoval)
			.values({
				userId: params.userId,
				actorUserId: params.actorUserId,
				kind: params.kind,
				reason: params.reason.slice(0, STANDING_REASON_MAX),
				flagId: params.flagId,
				endsAt: params.kind === 'suspension' ? (params.endsAt ?? null) : null,
				ledger: params.ledger
			})
			.returning();
		return row;
	} catch (err) {
		if (isUniqueConstraintError(err)) throw new RemovalAlreadyOpenError();
		throw err;
	}
}

/**
 * Close the member's open removal. Null when there is none, which is the case
 * for a ban recorded before this table existed: lifting it still works.
 */
export async function liftOpenRemoval(
	userId: string,
	params: { liftedByUserId: string | null; liftReason: RemovalLiftReason; now?: Date }
): Promise<AccountRemoval | null> {
	const [row] = await db
		.update(accountRemoval)
		.set({
			liftedAt: params.now ?? new Date(),
			liftedByUserId: params.liftedByUserId,
			liftReason: params.liftReason
		})
		.where(and(eq(accountRemoval.userId, userId), isNull(accountRemoval.liftedAt)))
		.returning();
	return row ?? null;
}

export async function getOpenRemoval(userId: string): Promise<AccountRemoval | null> {
	const [row] = await db
		.select()
		.from(accountRemoval)
		.where(and(eq(accountRemoval.userId, userId), isNull(accountRemoval.liftedAt)))
		.limit(1);
	return row ?? null;
}

export interface RemovalHistoryRow {
	id: string;
	kind: RemovalKind;
	reason: string;
	flagId: string;
	endsAt: Date | null;
	createdAt: Date;
	actorName: string | null;
	liftedAt: Date | null;
	liftReason: RemovalLiftReason | null;
	liftedByName: string | null;
}

/** Every removal of this member, newest first, for the staff history card. */
export async function listRemovals(userId: string): Promise<RemovalHistoryRow[]> {
	const actor = alias(user, 'actor');
	const lifter = alias(user, 'lifter');
	return db
		.select({
			id: accountRemoval.id,
			kind: accountRemoval.kind,
			reason: accountRemoval.reason,
			flagId: accountRemoval.flagId,
			endsAt: accountRemoval.endsAt,
			createdAt: accountRemoval.createdAt,
			actorName: actor.name,
			liftedAt: accountRemoval.liftedAt,
			liftReason: accountRemoval.liftReason,
			liftedByName: lifter.name
		})
		.from(accountRemoval)
		.leftJoin(actor, eq(actor.id, accountRemoval.actorUserId))
		.leftJoin(lifter, eq(lifter.id, accountRemoval.liftedByUserId))
		.where(eq(accountRemoval.userId, userId))
		.orderBy(desc(accountRemoval.createdAt), desc(accountRemoval.id));
}
