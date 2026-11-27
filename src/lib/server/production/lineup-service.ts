import { db } from '#lib/server/db/index.js';
import { and, eq, isNull } from 'drizzle-orm';
import { productionSlot } from '#lib/server/db/schema/production.js';
import { getEventLineup, setEventLineup, type LineupRow } from '#lib/server/event/event-service.js';
import { DomainError } from '#lib/server/domain-error.js';
import { addSlot, removeSlot } from './run-of-show-service';
import { assertNotTerminal } from './production-scope';
import type { LineupEntry } from '#lib/server/db/schema/event.js';

// ---------------------------------------------------------------------------
// A CMC show's lineup (#3272): each act is a credit on the bill and its set in
// the run of show, added and removed together. The bill's own rules — status,
// invitations, the cap — stay in `setEventLineup`, which this rewrites through.
// ---------------------------------------------------------------------------

export class ActNotOnLineupError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('That act is not on this lineup');
		this.name = 'ActNotOnLineupError';
	}
}

/** Who to add: a CMC band, an outside act on file, or a name only. */
export interface NewAct {
	name: string;
	bandId?: string;
	actId?: string;
}

function asEntries(rows: LineupRow[]): LineupEntry[] {
	return rows.map((r, i) => ({
		name: r.name,
		bandId: r.bandId ?? undefined,
		actId: r.actId ?? undefined,
		billingOrder: i,
		note: r.note ?? undefined
	}));
}

function isAct(row: LineupRow, act: NewAct): boolean {
	if (act.bandId) return row.bandId === act.bandId;
	if (act.actId) return row.actId === act.actId;
	return !row.bandId && !row.actId && row.name.toLowerCase() === act.name.trim().toLowerCase();
}

/** Put an act on the bill and give it a set at the end of the running order. */
export async function addActToShow(
	eventId: string,
	productionId: string,
	act: NewAct,
	setLengthMinutes: number
): Promise<void> {
	await assertNotTerminal({ productionId });
	const current = await getEventLineup(eventId);
	await setEventLineup(eventId, [...asEntries(current), { ...act, billingOrder: current.length }], {
		asStaff: true
	});
	const credit = (await getEventLineup(eventId)).find((r) => isAct(r, act));
	if (!credit) throw new ActNotOnLineupError();
	await addSlot(productionId, { eventBandId: credit.id, setLengthMinutes });
}

/**
 * Take an act off the bill and its set off the run of show. A set that was
 * already paid stays, detached from the credit: the payout is money moved.
 * A set with no credit (a DJ, a host) is removed on its own.
 */
export async function removeActFromShow(
	eventId: string,
	productionId: string,
	ref: { eventBandId?: string; slotId?: string }
): Promise<void> {
	await assertNotTerminal({ productionId });
	if (ref.slotId) {
		const [slot] = await db
			.select({ eventBandId: productionSlot.eventBandId })
			.from(productionSlot)
			.where(and(eq(productionSlot.id, ref.slotId), eq(productionSlot.productionId, productionId)));
		if (!slot) throw new ActNotOnLineupError();
		if (!slot.eventBandId) return removeSlot(ref.slotId);
		ref = { eventBandId: slot.eventBandId };
	}

	const current = await getEventLineup(eventId);
	if (!current.some((r) => r.id === ref.eventBandId)) throw new ActNotOnLineupError();

	await db
		.delete(productionSlot)
		.where(
			and(
				eq(productionSlot.productionId, productionId),
				eq(productionSlot.eventBandId, ref.eventBandId!),
				isNull(productionSlot.paidCents)
			)
		);
	await setEventLineup(eventId, asEntries(current.filter((r) => r.id !== ref.eventBandId)), {
		asStaff: true
	});
}
