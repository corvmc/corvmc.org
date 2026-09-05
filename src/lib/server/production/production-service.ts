import { db, getRowCount } from '$lib/server/db';
import { production } from '$lib/server/db/schema/production';
import { and, eq, getTableColumns, inArray } from 'drizzle-orm';
import { user } from '$lib/server/db/schema/authentication';
import { DomainError } from '$lib/server/domain-error';
import type { Production, ProductionStatus } from '$lib/server/db/schema/production';

/**
 * The ops half of a show.
 *
 * Thin except in one place: status. A production moves through the work of
 * putting a night on, and every move is an atomic conditional update rather
 * than a read followed by a write — D1 has no interactive transactions, so the
 * `WHERE … AND status IN (…)` + row-count check is the house pattern for this
 * (see `reservation-service.updateStatus`).
 */

export class ProductionNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Production not found');
	}
}

export class ProductionExistsError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('This event already has a production');
	}
}

/** 422, matching `InvalidLoanTransitionError` — a stale button, not a fault. */
export class InvalidProductionTransitionError extends DomainError {
	readonly httpStatus = 422;
	constructor(from: ProductionStatus, to: ProductionStatus) {
		super(`Cannot transition production from "${from}" to "${to}"`);
	}
}

/**
 * Which statuses a target may be reached **from**.
 *
 * Keyed by target rather than by source because that is literally the `IN (…)`
 * list the atomic update needs: no second derivation step, and no way for the
 * table and the SQL to disagree.
 *
 * `settled` and `closed` have no button in the UI yet — the settlement
 * worksheet and the close-out drive them, and neither is built. They are here
 * so the machine is declared whole; do not "finish" the button set.
 */
const REACHABLE_FROM: Record<ProductionStatus, readonly ProductionStatus[]> = {
	// Un-offer, because a mis-click needs a way back.
	draft: ['offered'],
	offered: ['draft'],
	// A show can be booked outright without ever being offered.
	confirmed: ['draft', 'offered'],
	completed: ['confirmed'],
	settled: ['completed'],
	closed: ['settled'],
	// Any pre-completed state. Once a night has happened it is history.
	cancelled: ['draft', 'offered', 'confirmed']
};

/** The statuses a production can still be pulled out of when its event is cancelled. */
const PRE_COMPLETED: readonly ProductionStatus[] = ['draft', 'offered', 'confirmed'];

export interface ProductionDetailsInput {
	producerUserId?: string | null;
	loadInAt?: Date | null;
	soundcheckAt?: Date | null;
	firstSetAt?: Date | null;
	curfewAt?: Date | null;
	loadOutBy?: Date | null;
	billingNotes?: string | null;
	hospitalityNotes?: string | null;
	internalNotes?: string | null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getProduction(id: string): Promise<Production> {
	const [row] = await db.select().from(production).where(eq(production.id, id)).limit(1);
	if (!row) throw new ProductionNotFoundError();
	return row;
}

export interface ProductionWithProducer extends Production {
	/** Null when nobody has taken it, or when the account behind it was purged. */
	producerName: string | null;
}

/**
 * The console's read. The producer's name rides along on a left join rather
 * than being looked up beside it — the console already loads everything in one
 * `Promise.all`, and a name is not worth a second round trip.
 */
export async function getProductionByEvent(
	eventId: string
): Promise<ProductionWithProducer | null> {
	const [row] = await db
		.select({ ...getTableColumns(production), producerName: user.name })
		.from(production)
		.leftJoin(user, eq(user.id, production.producerUserId))
		.where(eq(production.eventId, eventId))
		.limit(1);
	return row ?? null;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Open a production on an event.
 *
 * The 1:1 is enforced by `uq_production_event`, so this inserts and reads the
 * violation rather than selecting first: a select-then-insert is a race, and
 * the index is the thing that actually holds the invariant.
 */
export async function createProduction(
	eventId: string,
	opts?: { createdByUserId?: string }
): Promise<Production> {
	try {
		const [row] = await db
			.insert(production)
			.values({ eventId, createdByUserId: opts?.createdByUserId ?? null })
			.returning();
		return row;
	} catch (err) {
		const message = (err as Error).message ?? '';
		if (/UNIQUE constraint failed/i.test(message)) throw new ProductionExistsError();
		throw err;
	}
}

/**
 * The times, the producer and the three notes. **Not** status — status only
 * moves through `transitionProduction`, which is the only place the legal edges
 * are written down.
 */
export async function updateProductionDetails(
	id: string,
	data: ProductionDetailsInput
): Promise<Production> {
	const [row] = await db
		.update(production)
		.set({ ...data, updatedAt: new Date() })
		.where(eq(production.id, id))
		.returning();

	if (!row) throw new ProductionNotFoundError();
	return row;
}

export async function transitionProduction(id: string, to: ProductionStatus): Promise<Production> {
	const from = REACHABLE_FROM[to];

	const result = await db
		.update(production)
		.set({ status: to, updatedAt: new Date() })
		.where(and(eq(production.id, id), inArray(production.status, [...from])));

	if (getRowCount(result) === 0) {
		// Zero rows is either "no such production" or "wrong status"; say which.
		const [row] = await db
			.select({ status: production.status })
			.from(production)
			.where(eq(production.id, id))
			.limit(1);

		if (!row) throw new ProductionNotFoundError();
		throw new InvalidProductionTransitionError(row.status, to);
	}

	return getProduction(id);
}

/**
 * Follow an event that was cancelled.
 *
 * One conditional update rather than a read and a branch: a production that
 * already `completed` (or settled, or closed) describes a night that happened,
 * and cancelling the listing afterwards does not un-happen it. Without this the
 * index would show `confirmed` productions against cancelled shows on day one.
 */
export async function cancelProductionsForEvent(eventId: string): Promise<number> {
	const result = await db
		.update(production)
		.set({ status: 'cancelled', updatedAt: new Date() })
		.where(and(eq(production.eventId, eventId), inArray(production.status, [...PRE_COMPLETED])));

	return getRowCount(result);
}

export type { Production, ProductionStatus };
