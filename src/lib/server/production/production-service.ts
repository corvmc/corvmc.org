import { db, getRowCount } from '$lib/server/db';
import { memberRefColumns, toMemberRef } from '$lib/server/entity/refs';
import { production } from '$lib/server/db/schema/production';
import { and, eq, getTableColumns, inArray, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { user } from '$lib/server/db/schema/authentication';
import { eventListing } from '$lib/server/db/schema/event';
import { dutyList, workOrder, workTask } from '$lib/server/db/schema/volunteer';
import { DomainError } from '$lib/server/domain-error';
import type { Production, ProductionStatus } from '$lib/server/db/schema/production';
import { recomputeSetTimes } from './run-of-show-service';

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

/**
 * Declared here rather than imported from `event-service`, which imports *this*
 * module for `cancelProductionsForEvent`. A shared errors module for one 404 is
 * more machinery than the duplication costs.
 */
export class ListingNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Event not found');
	}
}

/** 422: a stale button on a listing that should never have offered it. */
export class NotACmcListingError extends DomainError {
	readonly httpStatus = 422;
	constructor(source: string) {
		super(`A production is for a show CMC puts on; this listing's source is "${source}"`);
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
 * `settled` is #593's tab; `closed` is gated below on the load-out checklist
 * being finished.
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
export class CloseOutIncompleteError extends DomainError {
	readonly httpStatus = 422;
	constructor(readonly outstanding: string[]) {
		super(
			`Close-out is not finished: ${outstanding.slice(0, 5).join(', ')}` +
				(outstanding.length > 5 ? ` and ${outstanding.length - 5} more` : '')
		);
		this.name = 'CloseOutIncompleteError';
	}
}

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
	/** The producer as a record, so the console can link to them. */
	producer: import('$lib/types/entity').MemberRef | null;
	/** Null when nobody has taken it, or when the account behind it was purged. */
	producerName: string | null;
	/** Null until close-out is signed off, or once that account is purged. */
	closedByName: string | null;
}

/**
 * The console's read. The producer's name rides along on a left join rather
 * than being looked up beside it — the console already loads everything in one
 * `Promise.all`, and a name is not worth a second round trip.
 */
export async function getProductionByEvent(
	eventId: string
): Promise<ProductionWithProducer | null> {
	const closer = alias(user, 'closed_by_user');
	const [row] = await db
		.select({
			...getTableColumns(production),
			producerName: user.name,
			closedByName: closer.name,
			// The producer as a record rather than a name: the console showed the
			// string and gave no way to reach the person running the night.
			producer: memberRefColumns()
		})
		.from(production)
		.leftJoin(user, eq(user.id, production.producerUserId))
		.leftJoin(closer, eq(closer.id, production.closedByUserId))
		.where(eq(production.eventId, eventId))
		.limit(1);

	if (!row) return null;
	const { producer, ...rest } = row;
	return { ...rest, producer: rest.producerUserId ? toMemberRef(producer) : null };
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
 *
 * The **source** check above it is a different shape and is not a race. A
 * production is the ops record for a show CMC puts on, and `event_listing` is a
 * community calendar CMC also appears on — roughly nine listings in ten are
 * somebody else's gig at somebody else's venue, where load-in times, a producer
 * and a settlement mean nothing. `source` does not change under us in any way
 * that matters here, and no index can express "only for one enum value", so
 * reading it first is the check. The UI already hides the button; this is the
 * guard, and the guard is what a remote function is allowed to rely on.
 */
export async function createProduction(
	eventId: string,
	opts?: { createdByUserId?: string }
): Promise<Production> {
	const [listing] = await db
		.select({ source: eventListing.source })
		.from(eventListing)
		.where(eq(eventListing.id, eventId))
		.limit(1);
	if (!listing) throw new ListingNotFoundError();
	if (listing.source !== 'cmc') throw new NotACmcListingError(listing.source);

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

	// A moved downbeat moves every set after it. Keyed on the field being
	// *present* rather than on it having changed — comparing against a value read
	// before the write is a race, and the recompute is idempotent and costs one
	// select when nothing moved. `setProductionProducer` posts only
	// `producerUserId`, so the common non-timing edit skips this entirely.
	if ('firstSetAt' in data) await recomputeSetTimes(row.id);

	return row;
}

/**
 * The close-out tasks a show still owes.
 *
 * Load-out work: tasks on a work order for this event whose duty list is
 * anchored at `load_out`. The room being reset is the thing `closed` claims,
 * and a button that claimed it without checking would be the button
 * `production-service` warns against finishing.
 */
export async function outstandingCloseOutTasks(productionId: string): Promise<string[]> {
	const rows = await db
		.select({ label: workTask.label })
		.from(workTask)
		.innerJoin(workOrder, eq(workOrder.id, workTask.workOrderId))
		.innerJoin(production, eq(production.eventId, workOrder.eventId))
		.innerJoin(dutyList, eq(dutyList.id, workOrder.dutyListId))
		.where(
			and(
				eq(production.id, productionId),
				eq(dutyList.anchor, 'load_out'),
				eq(workTask.done, false),
				isNull(workOrder.cancelledAt)
			)
		);
	return rows.map((r) => r.label);
}

export async function transitionProduction(
	id: string,
	to: ProductionStatus,
	actorUserId?: string | null
): Promise<Production> {
	const from = REACHABLE_FROM[to];

	// The gate is the whole feature: `closed` says the room is reset and the
	// checklist is done, so it refuses while any of it is open and names what.
	if (to === 'closed') {
		const outstanding = await outstandingCloseOutTasks(id);
		if (outstanding.length > 0) throw new CloseOutIncompleteError(outstanding);
	}

	// Stamped in the same conditional update as the status, so a row can never
	// read `closed` without saying when. `updatedAt` cannot stand in for it: it
	// moves again on the next write to the row.
	const closing =
		to === 'closed' ? { closedAt: new Date(), closedByUserId: actorUserId ?? null } : {};

	const result = await db
		.update(production)
		.set({ status: to, updatedAt: new Date(), ...closing })
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
