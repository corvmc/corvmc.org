import { db } from '$lib/server/db';
import { production, productionSlot } from '$lib/server/db/schema/production';
import { eventBand, eventListing } from '$lib/server/db/schema/event';
import { directoryEntry } from '$lib/server/db/schema/directory';
import { group } from '$lib/server/db/schema/group';
import { and, asc, eq, inArray, isNotNull, notInArray } from 'drizzle-orm';
import { computeSetTimes, orderSlots, runOfShowWarnings, SLOT_MAX } from './run-of-show';

import { DomainError } from '$lib/server/domain-error';
import type { EventBandStatus } from '$lib/server/db/schema/event';
import type { ActTerms } from '$lib/production/terms';
import type {
	PublicSetTime,
	RunOfShow,
	RunOfShowActStatus,
	RunOfShowSlot
} from '$lib/types/run-of-show';

/**
 * The DTO's status union is spelled out in `$lib/types`, which cannot import a
 * schema. This is what stops the two drifting: adding a value to
 * `eventBandStatuses` fails here until the DTO carries it too.
 */
import type { ProductionStatus } from '$lib/server/db/schema/production';

type _StatusesAgree = EventBandStatus extends RunOfShowActStatus ? true : never;
const _statusesAgree: _StatusesAgree = true;
void _statusesAgree;

export { computeSetTimes, orderSlots, runOfShowWarnings, SLOT_MAX } from './run-of-show';
export type { SetTimeSlot, WarnableSlot } from './run-of-show';

// ---------------------------------------------------------------------------
// Run of show — who plays when, derived from one downbeat and the set lengths.
// See `docs/specs/production-workflow-spec.md#run-of-show`.
//
// Imports nothing from `production-service`: the arrow goes the other way,
// since `updateProductionDetails` calls `recomputeSetTimes` when the downbeat
// moves. Its errors are declared here for that reason.
// ---------------------------------------------------------------------------

/**
 * Two neighbours this close have run out of midpoints to halve.
 *
 * A f64 mantissa survives about fifty halvings, so on a bill of twelve this is
 * unreachable in practice — but re-spacing is three lines and a lineup that
 * silently stops reordering is not.
 */
const SORT_EPSILON = 1e-6;

export class SlotNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('Slot not found');
		this.name = 'SlotNotFoundError';
	}
}

/** 422: the credit already has a set. The partial unique is what actually holds it. */
export class SlotExistsError extends DomainError {
	readonly httpStatus = 422;
	constructor() {
		super('That act already has a set in the running order');
		this.name = 'SlotExistsError';
	}
}

export class TooManySlotsError extends DomainError {
	readonly httpStatus = 422;
	constructor() {
		super(`At most ${SLOT_MAX} sets in a running order`);
		this.name = 'TooManySlotsError';
	}
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/**
 * The statuses at which a running order is real enough to print.
 *
 * `draft` and `offered` are a producer still sketching; `cancelled` is a night
 * that is not happening.
 */
const PUBLISHED_STATUSES: readonly ProductionStatus[] = [
	'confirmed',
	'completed',
	'settled',
	'closed'
];

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The whole running order for a listing, warnings included.
 *
 * Joins `event_listing` for `doorsAt` rather than taking it from the caller, so
 * the warning set stays whole inside the module that can test it.
 */
export async function getRunOfShow(eventId: string): Promise<RunOfShow | null> {
	const [rows, credits] = await Promise.all([
		db
			.select({
				productionId: production.id,
				firstSetAt: production.firstSetAt,
				curfewAt: production.curfewAt,
				doorsAt: eventListing.doorsAt,
				slotId: productionSlot.id,
				eventBandId: productionSlot.eventBandId,
				sortOrder: productionSlot.sortOrder,
				setLengthMinutes: productionSlot.setLengthMinutes,
				changeoverMinutes: productionSlot.changeoverMinutes,
				scheduledStartAt: productionSlot.scheduledStartAt,
				soundcheckAt: productionSlot.soundcheckAt,
				techNotes: productionSlot.techNotes,
				backlineNeeds: productionSlot.backlineNeeds,
				hospitalityNotes: productionSlot.hospitalityNotes,
				contactName: productionSlot.contactName,
				contactEmail: productionSlot.contactEmail,
				contactPhone: productionSlot.contactPhone,
				guaranteeCents: productionSlot.guaranteeCents,
				percentageBps: productionSlot.percentageBps,
				versus: productionSlot.versus,
				againstNet: productionSlot.againstNet,
				contributed: productionSlot.contributed,
				createdAt: productionSlot.createdAt,
				actName: eventBand.name,
				actStatus: eventBand.status,
				actSlug: group.slug
			})
			.from(production)
			.innerJoin(eventListing, eq(eventListing.id, production.eventId))
			.leftJoin(productionSlot, eq(productionSlot.productionId, production.id))
			.leftJoin(eventBand, eq(eventBand.id, productionSlot.eventBandId))
			.leftJoin(directoryEntry, eq(directoryEntry.id, eventBand.directoryEntryId))
			.leftJoin(group, eq(group.id, directoryEntry.groupId))
			.where(eq(production.eventId, eventId)),
		db
			.select({
				eventBandId: eventBand.id,
				name: eventBand.name,
				billingOrder: eventBand.billingOrder
			})
			.from(eventBand)
			.where(eq(eventBand.eventId, eventId))
			.orderBy(asc(eventBand.billingOrder))
	]);

	// The left join means one all-null-slot row for a production with no sets, so
	// "no production" and "no slots" are the same query and different answers.
	if (rows.length === 0) return null;

	// The left join types every slot column as nullable. `slotId` is the one that
	// says whether the row is a set at all, so it is the only narrowing needed —
	// the rest are non-null by the schema once it is.
	const ordered = orderSlots(
		rows
			.filter((r) => r.slotId !== null)
			.map((r) => ({
				id: r.slotId!,
				eventBandId: r.eventBandId,
				actName: r.actName,
				actStatus: r.actStatus,
				actSlug: r.actSlug,
				sortOrder: r.sortOrder!,
				createdAt: r.createdAt!,
				setLengthMinutes: r.setLengthMinutes!,
				changeoverMinutes: r.changeoverMinutes!,
				scheduledStartAt: r.scheduledStartAt,
				soundcheckAt: r.soundcheckAt,
				techNotes: r.techNotes,
				backlineNeeds: r.backlineNeeds,
				hospitalityNotes: r.hospitalityNotes,
				contactName: r.contactName,
				contactEmail: r.contactEmail,
				contactPhone: r.contactPhone,
				terms: {
					guaranteeCents: r.guaranteeCents,
					percentageBps: r.percentageBps,
					versus: r.versus ?? false,
					againstNet: r.againstNet ?? false,
					contributed: r.contributed ?? false
				}
			}))
	);

	const slots: RunOfShowSlot[] = ordered.map((r) => ({
		id: r.id,
		eventBandId: r.eventBandId,
		actName: r.actName,
		actStatus: r.actStatus,
		actSlug: r.actSlug,
		sortOrder: r.sortOrder,
		setLengthMinutes: r.setLengthMinutes,
		changeoverMinutes: r.changeoverMinutes,
		scheduledStartAt: r.scheduledStartAt,
		scheduledEndAt: r.scheduledStartAt
			? new Date(r.scheduledStartAt.getTime() + r.setLengthMinutes * 60_000)
			: null,
		soundcheckAt: r.soundcheckAt,
		techNotes: r.techNotes,
		backlineNeeds: r.backlineNeeds,
		hospitalityNotes: r.hospitalityNotes,
		contactName: r.contactName,
		contactEmail: r.contactEmail,
		contactPhone: r.contactPhone,
		terms: r.terms
	}));

	const slotted = new Set(slots.map((s) => s.eventBandId).filter((id): id is string => !!id));

	return {
		productionId: rows[0].productionId,
		firstSetAt: rows[0].firstSetAt,
		curfewAt: rows[0].curfewAt,
		slots,
		unslotted: credits.filter((c) => !slotted.has(c.eventBandId)),
		warnings: runOfShowWarnings({
			firstSetAt: rows[0].firstSetAt,
			curfewAt: rows[0].curfewAt,
			doorsAt: rows[0].doorsAt,
			slots: ordered.map((r) => ({ ...r, name: r.actName }))
		})
	};
}

/**
 * The running order as the public sees it: names and start times, in order.
 *
 * Every gate is in SQL — the production exists, it is `confirmed` or later, the
 * downbeat is set, and the slot still names a credit. An empty array is the
 * honest answer for all four, and the caller renders nothing.
 */
export async function getPublicSetTimes(eventId: string): Promise<PublicSetTime[]> {
	const rows = await db
		.select({
			name: eventBand.name,
			scheduledStartAt: productionSlot.scheduledStartAt,
			sortOrder: productionSlot.sortOrder,
			createdAt: productionSlot.createdAt
		})
		.from(productionSlot)
		.innerJoin(production, eq(production.id, productionSlot.productionId))
		.innerJoin(eventBand, eq(eventBand.id, productionSlot.eventBandId))
		.where(
			and(
				eq(production.eventId, eventId),
				inArray(production.status, [...PUBLISHED_STATUSES]),
				isNotNull(production.firstSetAt),
				isNotNull(productionSlot.scheduledStartAt)
			)
		);

	return orderSlots(rows).map((r) => ({
		name: r.name,
		scheduledStartAt: r.scheduledStartAt!
	}));
}

// ---------------------------------------------------------------------------
// The recompute
// ---------------------------------------------------------------------------

function sameInstant(a: Date | null, b: Date | null): boolean {
	if (a === null || b === null) return a === b;
	return a.getTime() === b.getTime();
}

/**
 * Rewrite every derived start time on a production.
 *
 * One select, then one `db.batch` of only the updates that change — which is
 * what makes it cheap enough to run unconditionally. At most `SLOT_MAX`
 * single-row updates, so nothing here approaches D1's 100-parameter cap; a
 * `CASE id WHEN …` would be one statement and unreadable SQL for a dozen rows.
 */
export async function recomputeSetTimes(productionId: string): Promise<void> {
	const rows = await db
		.select({
			firstSetAt: production.firstSetAt,
			slotId: productionSlot.id,
			sortOrder: productionSlot.sortOrder,
			createdAt: productionSlot.createdAt,
			setLengthMinutes: productionSlot.setLengthMinutes,
			changeoverMinutes: productionSlot.changeoverMinutes,
			scheduledStartAt: productionSlot.scheduledStartAt
		})
		.from(production)
		.leftJoin(productionSlot, eq(productionSlot.productionId, production.id))
		.where(eq(production.id, productionId));

	if (rows.length === 0) return;

	const slots = rows
		.filter((r) => r.slotId !== null)
		.map((r) => ({
			id: r.slotId!,
			sortOrder: r.sortOrder!,
			createdAt: r.createdAt!,
			setLengthMinutes: r.setLengthMinutes!,
			changeoverMinutes: r.changeoverMinutes!,
			scheduledStartAt: r.scheduledStartAt
		}));

	const times = computeSetTimes(rows[0].firstSetAt, slots);

	const writes = slots
		.filter((s) => !sameInstant(times.get(s.id) ?? null, s.scheduledStartAt))
		.map((s) =>
			db
				.update(productionSlot)
				.set({ scheduledStartAt: times.get(s.id) ?? null, updatedAt: new Date() })
				.where(eq(productionSlot.id, s.id))
		);

	// `db.batch([])` is a type error — drizzle types the argument as a non-empty
	// tuple — so the guard is not cosmetic.
	if (writes.length) await db.batch(writes as [(typeof writes)[number], ...typeof writes]);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

interface OrderedSlot {
	id: string;
	sortOrder: number;
	createdAt: Date;
}

async function readOrder(productionId: string): Promise<OrderedSlot[]> {
	const rows = await db
		.select({
			id: productionSlot.id,
			sortOrder: productionSlot.sortOrder,
			createdAt: productionSlot.createdAt
		})
		.from(productionSlot)
		.where(eq(productionSlot.productionId, productionId));
	return orderSlots(rows);
}

/**
 * Re-space a production's slots to 1, 2, 3 … .
 *
 * The one operation that writes every row, which is why it is deliberately not
 * the reorder path — it runs only when two neighbours have converged past
 * `SORT_EPSILON`, which repeated midpoints will eventually do.
 */
async function normalizeSortOrders(slots: OrderedSlot[]): Promise<OrderedSlot[]> {
	const writes = slots.map((s, i) =>
		db
			.update(productionSlot)
			.set({ sortOrder: i + 1, updatedAt: new Date() })
			.where(eq(productionSlot.id, s.id))
	);
	if (writes.length) await db.batch(writes as [(typeof writes)[number], ...typeof writes]);
	return slots.map((s, i) => ({ ...s, sortOrder: i + 1 }));
}

function tooClose(slots: OrderedSlot[]): boolean {
	return slots.some((s, i) => i > 0 && s.sortOrder - slots[i - 1].sortOrder < SORT_EPSILON);
}

export interface AddSlotInput {
	eventBandId?: string | null;
	setLengthMinutes: number;
	changeoverMinutes?: number;
}

/** Append a set to the running order. */
export async function addSlot(productionId: string, input: AddSlotInput): Promise<string> {
	const slots = await readOrder(productionId);
	if (slots.length >= SLOT_MAX) throw new TooManySlotsError();

	const sortOrder = slots.length ? slots[slots.length - 1].sortOrder + 1 : 1;

	try {
		// Insert and read the violation rather than selecting first: the partial
		// unique is the thing that actually holds the 1:1, and a select-then-insert
		// is a race around it.
		const [row] = await db
			.insert(productionSlot)
			.values({
				productionId,
				eventBandId: input.eventBandId || null,
				sortOrder,
				setLengthMinutes: input.setLengthMinutes,
				changeoverMinutes: input.changeoverMinutes ?? 10
			})
			.returning({ id: productionSlot.id });

		await recomputeSetTimes(productionId);
		return row.id;
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (/UNIQUE constraint failed/i.test(message)) throw new SlotExistsError();
		throw err;
	}
}

export interface UpdateSlotInput {
	setLengthMinutes?: number;
	changeoverMinutes?: number;
	soundcheckAt?: Date | null;
	techNotes?: string | null;
	backlineNeeds?: string | null;
	hospitalityNotes?: string | null;
	contactName?: string | null;
	contactEmail?: string | null;
	contactPhone?: string | null;
}

/**
 * Edit one set.
 *
 * Recomputes only when the patch touched a length or a changeover — a tech note
 * cannot move a set time, and the guard keeps the common edit to one round trip.
 */
export async function updateSlot(slotId: string, patch: UpdateSlotInput): Promise<void> {
	const [row] = await db
		.update(productionSlot)
		.set({ ...patch, updatedAt: new Date() })
		.where(eq(productionSlot.id, slotId))
		.returning({ productionId: productionSlot.productionId });

	if (!row) throw new SlotNotFoundError();

	const movesTimes = patch.setLengthMinutes !== undefined || patch.changeoverMinutes !== undefined;
	if (movesTimes) await recomputeSetTimes(row.productionId);
}

/**
 * Move one set up or down the running order, as a single write.
 *
 * A direction rather than a target position, so a client working from a stale
 * list cannot drop a set in the wrong place. The moved row lands at the
 * midpoint of its neighbours and nothing else is renumbered.
 */
export async function moveSlot(slotId: string, direction: 'up' | 'down'): Promise<void> {
	const [owner] = await db
		.select({ productionId: productionSlot.productionId })
		.from(productionSlot)
		.where(eq(productionSlot.id, slotId))
		.limit(1);
	if (!owner) throw new SlotNotFoundError();

	let slots = await readOrder(owner.productionId);
	if (tooClose(slots)) slots = await normalizeSortOrders(slots);

	const at = slots.findIndex((s) => s.id === slotId);
	const target = direction === 'up' ? at - 1 : at + 1;
	// Already at the end it is moving towards. A no-op rather than an error: the
	// button is disabled, and a stale page pressing it is not a fault.
	if (at < 0 || target < 0 || target >= slots.length) return;

	const beyond = direction === 'up' ? target - 1 : target + 1;
	const neighbour = slots[target].sortOrder;
	const sortOrder =
		beyond >= 0 && beyond < slots.length
			? (neighbour + slots[beyond].sortOrder) / 2
			: direction === 'up'
				? neighbour - 1
				: neighbour + 1;

	await db
		.update(productionSlot)
		.set({ sortOrder, updatedAt: new Date() })
		.where(eq(productionSlot.id, slotId));

	await recomputeSetTimes(owner.productionId);
}

/**
 * Set what an act is paid.
 *
 * Its own function rather than fields on `updateSlot`: a timing save and a money
 * save want different confirmations, and this is the seam a settlement
 * capability would guard without splitting a form that had already grown.
 */
export async function setSlotTerms(slotId: string, terms: ActTerms): Promise<void> {
	const [row] = await db
		.update(productionSlot)
		.set({
			guaranteeCents: terms.guaranteeCents,
			percentageBps: terms.percentageBps,
			versus: terms.versus,
			againstNet: terms.againstNet,
			contributed: terms.contributed,
			updatedAt: new Date()
		})
		.where(eq(productionSlot.id, slotId))
		.returning({ id: productionSlot.id });

	if (!row) throw new SlotNotFoundError();
}

/** Drop a set. The gap it leaves in `sortOrder` is correct — nothing renumbers. */
export async function removeSlot(slotId: string): Promise<void> {
	const [row] = await db
		.delete(productionSlot)
		.where(eq(productionSlot.id, slotId))
		.returning({ productionId: productionSlot.productionId });

	if (!row) throw new SlotNotFoundError();
	await recomputeSetTimes(row.productionId);
}

/** A default set, long enough to be a set and short enough to be edited down. */
const DEFAULT_SET_MINUTES = 30;

/**
 * One set per credit that has none, in billing order.
 *
 * The empty state's one button: a bill is already a running order in the usual
 * case, and typing it in twice is the kind of work an app should not ask for.
 */
export async function buildSlotsFromLineup(productionId: string, eventId: string): Promise<number> {
	const existing = await readOrder(productionId);
	if (existing.length >= SLOT_MAX) throw new TooManySlotsError();

	const taken = await db
		.select({ eventBandId: productionSlot.eventBandId })
		.from(productionSlot)
		.where(
			and(eq(productionSlot.productionId, productionId), isNotNull(productionSlot.eventBandId))
		);
	const takenIds = taken.map((t) => t.eventBandId!).filter((id): id is string => !!id);

	const credits = await db
		.select({ id: eventBand.id })
		.from(eventBand)
		.where(
			takenIds.length
				? and(eq(eventBand.eventId, eventId), notInArray(eventBand.id, takenIds))
				: eq(eventBand.eventId, eventId)
		)
		.orderBy(asc(eventBand.billingOrder));

	const room = SLOT_MAX - existing.length;
	const rows = credits.slice(0, room).map((c, i) => ({
		productionId,
		eventBandId: c.id,
		sortOrder: (existing.length ? existing[existing.length - 1].sortOrder : 0) + i + 1,
		setLengthMinutes: DEFAULT_SET_MINUTES
	}));
	if (rows.length === 0) return 0;

	// Four columns a row, so twelve rows is well under D1's 100-parameter cap and
	// a single statement covers the whole bill.
	await db.insert(productionSlot).values(rows);
	await recomputeSetTimes(productionId);
	return rows.length;
}

/**
 * Which production a listing has, or null.
 *
 * Here rather than in `production-service` so a remote that only writes slots
 * needs one import, and so the arrow between the two modules stays one-way.
 */
export async function findProductionIdForEvent(eventId: string): Promise<string | null> {
	const [row] = await db
		.select({ id: production.id })
		.from(production)
		.where(eq(production.eventId, eventId))
		.limit(1);
	return row?.id ?? null;
}
