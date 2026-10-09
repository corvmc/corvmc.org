import { db, getRowCount } from '$lib/server/db';
import {
	postProductionExpenses,
	reverseProductionExpense
} from '$lib/server/finance/production-expense-entries';
import { expenseLines } from './expense-service';
import { assertNotTerminal, ProductionTerminalError } from './production-scope';
import { isTerminalProduction, transitionWarnings } from '$lib/production/status';
import { recordAuditEntry } from '$lib/server/audit/audit-service';
import { memberRefColumns, toMemberRef } from '$lib/server/entity/refs';
import { production } from '$lib/server/db/schema/production';
import { and, eq, getTableColumns, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { user } from '$lib/server/db/schema/authentication';
import { eventListing } from '$lib/server/db/schema/event';
import { dutyList, workOrder, workTask } from '$lib/server/db/schema/volunteer';
import { DomainError } from '$lib/server/domain-error';
import type { Production, ProductionStatus } from '$lib/server/db/schema/production';
import { recomputeSetTimes } from './run-of-show-service';
import {
	announceProductionCreated,
	createShowProject,
	deleteShowProject
} from './production-project';
import { announceShowsCancelled, openDeliverablesOnProductions } from './cancellation-notice';
import type { OpenOwnedItem } from '$lib/server/volunteer/deliverables-service';
import { shiftAnchoredWorkOrders } from '$lib/server/volunteer/retime-work-orders';
import type { BatchItem } from 'drizzle-orm/batch';
import type { DutyListAnchor, ProjectStatus } from '$lib/config';
import { project } from '$lib/server/db/schema/project';
import { cancelShiftsForProduction } from '$lib/server/volunteer/show-cancellation';
import { captureException } from '$lib/server/sentry';

/**
 * The ops half of a show.
 *
 * Thin except in one place: status, which follows warn, record, allow
 * (docs/development/conventions.md#workflow-gates). Every move is a
 * compare-and-swap on the status its warnings were computed against — D1 has
 * no interactive transactions, so `WHERE … AND status = ?` plus a row count
 * is the house pattern (see `reservation-service.updateStatus`).
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

/** 422: an override names no reason, so the audit log would say nothing. */
export class OverrideReasonRequiredError extends DomainError {
	readonly httpStatus = 422;
	constructor() {
		super('Give a reason for this change; it is written to the audit log.');
		this.name = 'OverrideReasonRequiredError';
	}
}

/** 409: somebody else moved the show between the read and the write. */
export class ProductionMovedError extends DomainError {
	readonly httpStatus = 409;
	constructor() {
		super('This show changed status while you were looking at it. Reload and try again.');
		this.name = 'ProductionMovedError';
	}
}

/** 422: `reopenProduction` is for a terminal show, and to a non-terminal status. */
export class InvalidReopenError extends DomainError {
	readonly httpStatus = 422;
	constructor(message: string) {
		super(message);
		this.name = 'InvalidReopenError';
	}
}

/** The statuses a production can still be pulled out of when its event is cancelled. */
const PRE_COMPLETED: readonly ProductionStatus[] = ['draft', 'offered', 'confirmed'];

export interface ProductionDetailsInput {
	producerUserId?: string | null;
	loadInAt?: Date | null;
	soundcheckAt?: Date | null;
	firstSetAt?: Date | null;
	curfewAt?: Date | null;
	loadOutBy?: Date | null;
	/** How many acts the bill should end up with. Null clears the target. */
	actsWanted?: number | null;
	billingNotes?: string | null;
	hospitalityNotes?: string | null;
	internalNotes?: string | null;
	/** The drawer count at the end of the night, and how it splits (#929). */
	doorCashCents?: number | null;
	doorCount?: number | null;
	doorSplitActsPercent?: number | null;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The production a listing announces.
 *
 * A correlated subquery because callers filter `production` while holding an
 * event id. The edge is on the listing now — it names what it advertises, and
 * the production no longer hangs off its own advertisement (#1202).
 */
export function announcedBy(eventId: string): SQL {
	return sql`"production"."id" = (
		select "event_listing"."production_id" from "event_listing"
		 where "event_listing"."id" = ${eventId}
	)`;
}

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
		.where(announcedBy(eventId))
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
 * The 1:1 is held by a conditional update: the listing takes the new production
 * only while it is announcing none, and a zero row count means somebody else
 * got there first. Same shape as `reservation-service.updateStatus`, and the
 * reason is the same — D1 has no interactive transaction to hold a check and a
 * write together.
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
	/**
	 * `id` is for `event-service.create()`, which books the room before the
	 * listing row exists and so mints the id itself — the booker has to name the
	 * show before either row is written.
	 */
	opts?: { createdByUserId?: string; id?: string }
): Promise<Production> {
	const [listing] = await db
		.select({
			source: eventListing.source,
			title: eventListing.title,
			startsAt: eventListing.startsAt,
			endsAt: eventListing.endsAt
		})
		.from(eventListing)
		.where(eq(eventListing.id, eventId))
		.limit(1);
	if (!listing) throw new ListingNotFoundError();
	if (listing.source !== 'cmc') throw new NotACmcListingError(listing.source);

	const productionId = opts?.id ?? crypto.randomUUID();
	const projectId = crypto.randomUUID();
	await createShowProject({
		productionId,
		projectId,
		name: listing.title,
		startsAt: listing.startsAt,
		endsAt: listing.endsAt,
		createdByUserId: opts?.createdByUserId ?? null
	});

	// The listing names what it announces, so claiming it is the write that can
	// lose. If it does, the rows just written have nothing announcing them and are
	// removed rather than left as a shell nothing can reach.
	const claimed = await db
		.update(eventListing)
		.set({ productionId, projectId, updatedAt: new Date() })
		.where(and(eq(eventListing.id, eventId), isNull(eventListing.productionId)));

	if (getRowCount(claimed) === 0) {
		await deleteShowProject(productionId);
		throw new ProductionExistsError();
	}

	const [row] = await db.select().from(production).where(eq(production.id, productionId));
	await announceProductionCreated(productionId, eventId, opts?.createdByUserId ?? null);
	return row;
}

type Batch = [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]];

/** Each production time, the duty-list anchor measured from it, and its column. */
const SHOW_CLOCK = [
	['loadInAt', 'load_in', production.loadInAt],
	['soundcheckAt', 'soundcheck', production.soundcheckAt],
	['firstSetAt', 'first_set', production.firstSetAt],
	['curfewAt', 'curfew', production.curfewAt],
	['loadOutBy', 'load_out', production.loadOutBy]
] as const satisfies readonly (readonly [keyof ProductionDetailsInput, DutyListAnchor, unknown])[];

/**
 * The times, the producer and the three notes. **Not** status — status only
 * moves through `transitionProduction` and `reopenProduction`.
 */
export async function updateProductionDetails(
	id: string,
	data: ProductionDetailsInput
): Promise<Production> {
	await assertNotTerminal({ productionId: id });
	const update = db
		.update(production)
		.set({ ...data, updatedAt: new Date() })
		.where(eq(production.id, id))
		.returning();

	// Shifts anchored to a time that moves, moved by the same amount. Each shift
	// reads the old time in the batch, before the update writes the new one.
	const [listing] = await db
		.select({ id: eventListing.id })
		.from(eventListing)
		.where(eq(eventListing.productionId, id))
		.limit(1);
	const shifts = listing
		? SHOW_CLOCK.flatMap(([key, anchor, column]) => {
				const next = data[key];
				if (!(next instanceof Date)) return [];
				const seconds = Math.floor(next.getTime() / 1000);
				const delta = sql`${seconds} - (select ${column} from ${production} where ${production.id} = ${id})`;
				return [shiftAnchoredWorkOrders(listing.id, [anchor], delta)];
			})
		: [];

	const [row] =
		shifts.length > 0
			? ((await db.batch([...shifts, update] as unknown as Batch)).at(-1) as Production[])
			: await update;

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
 * so a close with any of these open warns and names them.
 */
export async function outstandingCloseOutTasks(productionId: string): Promise<string[]> {
	return (await closeOutTasksOwed([productionId])).map((r) => r.label);
}

/**
 * The same question for many shows at once, for a deliverable's `close_out_done`
 * condition. One predicate, so the `closed` warning and the deliverable agree.
 */
export async function productionsOwingCloseOut(productionIds: string[]): Promise<Set<string>> {
	if (productionIds.length === 0) return new Set();
	return new Set((await closeOutTasksOwed(productionIds)).map((r) => r.productionId));
}

function closeOutTasksOwed(productionIds: string[]) {
	return db
		.select({ productionId: production.id, label: workTask.label })
		.from(workTask)
		.innerJoin(workOrder, eq(workOrder.id, workTask.workOrderId))
		.innerJoin(eventListing, eq(eventListing.id, workOrder.eventId))
		.innerJoin(production, eq(production.id, eventListing.productionId))
		.innerJoin(dutyList, eq(dutyList.id, workOrder.dutyListId))
		.where(
			and(
				inArray(production.id, productionIds),
				eq(dutyList.anchor, 'load_out'),
				eq(workTask.done, false),
				isNull(workOrder.cancelledAt)
			)
		);
}

export interface TransitionOptions {
	actorUserId?: string | null;
	/** The caller has shown the warnings and the user went ahead. */
	acknowledged?: boolean;
	/** Required when the move has warnings; written to the audit log. */
	reason?: string | null;
}

export type TransitionOutcome =
	| { moved: true; production: Production; warnings: string[] }
	| { moved: false; warnings: string[] };

/**
 * Move a show to any status, terminal ones included.
 *
 * Unacknowledged warnings come back unmoved so the console can show them; an
 * acknowledged move needs a reason and is recorded as an override. A show
 * already closed or cancelled refuses: that is `reopenProduction`.
 */
export async function transitionProduction(
	id: string,
	to: ProductionStatus,
	opts: TransitionOptions = {}
): Promise<TransitionOutcome> {
	const current = await readForMove(id);
	if (isTerminalProduction(current.status)) throw new ProductionTerminalError(current.status);
	const from = current.status;

	const outstandingCloseOut = to === 'closed' ? await outstandingCloseOutTasks(id) : [];
	const warnings = transitionWarnings(from, to, { outstandingCloseOut });
	const reason = opts.reason?.trim() ?? '';
	if (warnings.length > 0) {
		if (!opts.acknowledged) return { moved: false, warnings };
		if (!reason) throw new OverrideReasonRequiredError();
	}

	// Stamped in the same conditional update as the status, so a row can never
	// read `closed` without saying when. `updatedAt` cannot stand in for it.
	const closing =
		to === 'closed' ? { closedAt: new Date(), closedByUserId: opts.actorUserId ?? null } : {};
	// Before the move, which would make a confirmed lineup read as unconfirmed.
	const openBefore = to === 'cancelled' ? await openDeliverablesOnProductions([id]) : [];

	await moveStatus(id, from, to, closing);

	// The crew shifts go with the show (#1705). Reported rather than thrown: the
	// status has moved, and a retry would be refused as terminal.
	if (to === 'cancelled') {
		try {
			await cancelShiftsForProduction(id, opts.actorUserId);
		} catch (err) {
			captureException(err, {
				event: 'production.cancel.shifts',
				productionId: id
			});
		}
	}
	await followMoney(id, current.eventId, from, to);
	if (to === 'cancelled') {
		await announceShowsCancelled([id], opts.actorUserId ?? null, openBefore);
	}

	const subject = { type: 'production' as const, id, label: current.title };
	const move = { eventId: current.eventId, from, to };
	await recordAuditEntry(
		warnings.length > 0
			? {
					action: 'production.override',
					subject,
					details: { ...move, warnings, reason }
				}
			: { action: 'production.status_changed', subject, details: move }
	);

	return { moved: true, production: await getProduction(id), warnings };
}

/**
 * Take a closed or cancelled show back to a working status.
 *
 * Its own act, behind the admin-only `production.reopen`, because a terminal
 * state is the past. Clears the close-out stamp; the audit log keeps who
 * closed it. Cancelled shifts and the cancellation notice are not undone.
 */
export async function reopenProduction(
	id: string,
	to: ProductionStatus,
	reason: string
): Promise<Production> {
	const why = reason.trim();
	if (!why) throw new OverrideReasonRequiredError();
	if (isTerminalProduction(to)) {
		throw new InvalidReopenError('Reopen to a working status, not to closed or cancelled.');
	}
	const current = await readForMove(id);
	const from = current.status;
	if (!isTerminalProduction(from)) {
		throw new InvalidReopenError(`This show is ${from}, not closed or cancelled.`);
	}

	await moveStatus(id, from, to, { closedAt: null, closedByUserId: null });
	await followMoney(id, current.eventId, from, to);
	await recordAuditEntry({
		action: 'production.reopened',
		subject: { type: 'production', id, label: current.title },
		details: { eventId: current.eventId, from, to, reason: why }
	});
	return getProduction(id);
}

async function readForMove(id: string) {
	const [row] = await db
		.select({
			status: production.status,
			eventId: eventListing.id,
			title: eventListing.title
		})
		.from(production)
		.leftJoin(eventListing, eq(eventListing.productionId, production.id))
		.where(eq(production.id, id))
		.limit(1);
	if (!row) throw new ProductionNotFoundError();
	return row;
}

/** The status, and the project with it, swapped only from the status the caller read. */
async function moveStatus(
	id: string,
	from: ProductionStatus,
	to: ProductionStatus,
	extra: Partial<Pick<Production, 'closedAt' | 'closedByUserId'>>
) {
	const move = db
		.update(production)
		.set({ status: to, updatedAt: new Date(), ...extra })
		.where(and(eq(production.id, id), eq(production.status, from)));
	const before = projectStatusFor(from);
	const after = projectStatusFor(to);
	const follow = after
		? followProject(eq(production.id, id), to, after)
		: before
			? reopenProject(id, to, before)
			: null;
	const result = follow && before !== after ? (await db.batch([move, follow]))[0] : await move;
	if (getRowCount(result) === 0) throw new ProductionMovedError();
}

/**
 * What a show's costs owe the ledger at its new status.
 *
 * Posted at `settled` and `closed` — a cost sheet is a worksheet until then —
 * and reversed on a move back below `settled`. Both are idempotent per line,
 * so any status may be revisited.
 */
async function followMoney(
	id: string,
	eventId: string | null,
	from: ProductionStatus,
	to: ProductionStatus
) {
	const posted = (s: ProductionStatus) => s === 'settled' || s === 'closed';
	if (posted(to) && eventId) await postProductionExpenses(id, eventId);
	if (posted(from) && !posted(to)) {
		for (const line of await expenseLines(id)) await reverseProductionExpense(line.id);
	}
}
/**
 * Follow an event that was cancelled.
 *
 * One conditional update rather than a read and a branch: a production that
 * already `completed` (or settled, or closed) describes a night that happened,
 * and cancelling the listing afterwards does not un-happen it. Without this the
 * index would show `confirmed` productions against cancelled shows on day one.
 */
export async function cancelProductionsForEvent(
	eventId: string,
	actorUserId: string | null = null,
	/** Read before the listing was cancelled, when the caller cancelled it first. */
	openBefore?: readonly OpenOwnedItem[]
): Promise<number> {
	const moving = await db
		.select({ id: production.id })
		.from(production)
		.where(and(announcedBy(eventId), inArray(production.status, [...PRE_COMPLETED])));
	const open = openBefore ?? (await openDeliverablesOnProductions(moving.map((m) => m.id)));
	const [result] = await db.batch([
		db
			.update(production)
			.set({ status: 'cancelled', updatedAt: new Date() })
			.where(and(announcedBy(eventId), inArray(production.status, [...PRE_COMPLETED]))),
		followProject(announcedBy(eventId), 'cancelled', 'declined')
	]);

	const moved = getRowCount(result);
	if (moved > 0) {
		await announceShowsCancelled(
			moving.map((m) => m.id),
			actorUserId,
			open
		);
	}
	return moved;
}

/**
 * A finished show's project is done, and a cancelled show's is declined. The
 * project follows the show and never the reverse; null is a show still on.
 */
function projectStatusFor(status: ProductionStatus): ProjectStatus | null {
	if (status === 'cancelled') return 'declined';
	return status === 'completed' || status === 'settled' || status === 'closed' ? 'done' : null;
}

/** A show walked back before it happened: open its project again, if the show had closed it. */
function reopenProject(id: string, reached: ProductionStatus, was: ProjectStatus) {
	return db
		.update(project)
		.set({ status: 'open', updatedAt: new Date() })
		.where(
			and(
				eq(project.status, was),
				inArray(
					project.id,
					db
						.select({ id: production.projectId })
						.from(production)
						.where(and(eq(production.id, id), eq(production.status, reached)))
				)
			)
		);
}
/** Move the project of the productions matching `which`, once they reached `reached`. */
function followProject(which: SQL, reached: ProductionStatus, status: ProjectStatus) {
	return db
		.update(project)
		.set({ status, updatedAt: new Date() })
		.where(
			inArray(
				project.id,
				db
					.select({ id: production.projectId })
					.from(production)
					.where(and(which, eq(production.status, reached)))
			)
		);
}

export type { Production, ProductionStatus };
