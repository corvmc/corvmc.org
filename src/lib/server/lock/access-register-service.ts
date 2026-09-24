import { db } from '$lib/server/db';
import { accessHolding, lockMemberCode } from '$lib/server/db/schema/reservation';
import { user } from '$lib/server/db/schema/authentication';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { DomainError } from '$lib/server/domain-error';
import type { AccessHoldingKind } from '$lib/config';

/**
 * Who holds standing access to the building.
 *
 * Keys and alarm codes are recorded by hand in `access_holding`; standing lock
 * codes already live in `lock_member_code` and are read from there, so the two
 * cannot disagree. A per-booking door code is not standing access and is not
 * listed.
 */

export class AccessHoldingNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('That entry is not in the register.');
		this.name = 'AccessHoldingNotFoundError';
	}
}

export class AccessHoldingReturnedError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('That has already been returned.');
		this.name = 'AccessHoldingReturnedError';
	}
}

export class AccessHoldingValidationError extends DomainError {
	readonly httpStatus = 422;
	constructor(message: string) {
		super(message);
		this.name = 'AccessHoldingValidationError';
	}
}

export interface IssueHoldingInput {
	kind: AccessHoldingKind;
	label: string;
	/** A member. Their account name is used unless `holderName` overrides it. */
	holderUserId?: string | null;
	/** Required when there is no account — a landlord, a contractor. */
	holderName?: string | null;
	issuedByUserId: string;
	issuedAt?: Date;
	notes?: string | null;
}

export async function issueHolding(input: IssueHoldingInput) {
	const label = input.label.trim();
	if (!label) throw new AccessHoldingValidationError('Say which key or code this is.');

	let holderName = input.holderName?.trim() || null;
	if (!holderName && input.holderUserId) {
		const [member] = await db
			.select({ name: user.name })
			.from(user)
			.where(eq(user.id, input.holderUserId))
			.limit(1);
		holderName = member?.name ?? null;
	}
	if (!holderName) throw new AccessHoldingValidationError('Say who is holding it.');

	const [row] = await db
		.insert(accessHolding)
		.values({
			kind: input.kind,
			label,
			holderUserId: input.holderUserId ?? null,
			holderName,
			issuedAt: input.issuedAt ?? new Date(),
			issuedByUserId: input.issuedByUserId,
			notes: input.notes?.trim() || null
		})
		.returning();
	return row;
}

/** Close a holding. The row stays: the register is the history. */
export async function returnHolding(
	id: string,
	opts: { returnedByUserId: string; notes?: string | null; returnedAt?: Date }
) {
	const [row] = await db
		.update(accessHolding)
		.set({
			returnedAt: opts.returnedAt ?? new Date(),
			returnedByUserId: opts.returnedByUserId,
			returnNotes: opts.notes?.trim() || null
		})
		.where(and(eq(accessHolding.id, id), isNull(accessHolding.returnedAt)))
		.returning();
	if (row) return row;

	const [existing] = await db
		.select({ id: accessHolding.id })
		.from(accessHolding)
		.where(eq(accessHolding.id, id))
		.limit(1);
	throw existing ? new AccessHoldingReturnedError() : new AccessHoldingNotFoundError();
}

export type AccessRegisterKind = AccessHoldingKind | 'lock_code';

export interface AccessRegisterRow {
	id: string;
	/** `lock` rows are managed from Settings → Door access, not returned here. */
	source: 'register' | 'lock';
	kind: AccessRegisterKind;
	label: string;
	holderUserId: string | null;
	holderName: string;
	issuedAt: Date;
	issuedByName: string | null;
	notes: string | null;
	returnedAt: Date | null;
	returnNotes: string | null;
}

/** Everything still held, or with `includeReturned` the whole history. Holder A–Z. */
export async function listAccessRegister(
	opts: { includeReturned?: boolean } = {}
): Promise<AccessRegisterRow[]> {
	const issuer = alias(user, 'issuer');
	const member = alias(user, 'member');
	const granter = alias(user, 'granter');

	const [holdings, codes] = await Promise.all([
		db
			.select({
				id: accessHolding.id,
				kind: accessHolding.kind,
				label: accessHolding.label,
				holderUserId: accessHolding.holderUserId,
				holderName: accessHolding.holderName,
				issuedAt: accessHolding.issuedAt,
				notes: accessHolding.notes,
				returnedAt: accessHolding.returnedAt,
				returnNotes: accessHolding.returnNotes,
				issuedByName: issuer.name
			})
			.from(accessHolding)
			.leftJoin(issuer, eq(issuer.id, accessHolding.issuedByUserId))
			.where(opts.includeReturned ? undefined : isNull(accessHolding.returnedAt))
			.orderBy(asc(accessHolding.issuedAt), asc(accessHolding.id)),
		db
			.select({
				id: lockMemberCode.id,
				userId: lockMemberCode.userId,
				label: lockMemberCode.label,
				memberName: member.name,
				createdAt: lockMemberCode.createdAt,
				revokedAt: lockMemberCode.revokedAt,
				revokedReason: lockMemberCode.revokedReason,
				grantedByName: granter.name
			})
			.from(lockMemberCode)
			.leftJoin(member, eq(member.id, lockMemberCode.userId))
			.leftJoin(granter, eq(granter.id, lockMemberCode.grantedByStaffId))
			.where(opts.includeReturned ? undefined : isNull(lockMemberCode.revokedAt))
			.orderBy(asc(lockMemberCode.createdAt), asc(lockMemberCode.id))
	]);

	const rows: AccessRegisterRow[] = [
		...holdings.map((h) => ({ ...h, source: 'register' as const })),
		...codes.map((c) => ({
			id: c.id,
			source: 'lock' as const,
			kind: 'lock_code' as const,
			label: c.label,
			holderUserId: c.userId,
			// An adopted code nobody has matched to an account reads as its lock label.
			holderName: c.memberName ?? c.label,
			issuedAt: c.createdAt,
			issuedByName: c.grantedByName,
			notes: null,
			returnedAt: c.revokedAt,
			returnNotes: c.revokedReason
		}))
	];

	return rows.sort((a, b) => a.holderName.localeCompare(b.holderName));
}
