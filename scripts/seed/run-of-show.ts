import { eventBand } from '../../src/lib/server/db/schema/event';
import { production, productionSlot } from '../../src/lib/server/db/schema/production';
import { computeSetTimes } from '../../src/lib/server/production/run-of-show';
import { batchInsert, db } from './db';
import { asc, inArray } from 'drizzle-orm';

/**
 * Who plays when. Four states, because each renders differently:
 *
 * - **confirmed** — a clean schedule that fits inside curfew;
 * - **closed** — ran long, so the past-curfew warning has data;
 * - **offered** — sets but no downbeat, so every time is null;
 * - one slot with **no credit**: a DJ is on the running order, never the poster.
 */

/*
 * Set times come from `computeSetTimes`, the function the service runs.
 * Hand-writing them would seed a schedule that disagrees with the derived one.
 */

type ProductionRow = typeof production.$inferSelect;

interface Plan {
	/** Minutes on stage, per act down the bill. */
	sets: number[];
	changeover: number;
	/** Whether to add an uncredited slot after the acts. */
	dj?: boolean;
	/** Offsets from the downbeat, in hours, for the acts that soundcheck. */
	soundcheckOffsets?: (number | null)[];
}

export async function seedRunOfShow(productions: ProductionRow[]) {
	console.log('Seeding run of show...');

	const byStatus = (status: ProductionRow['status']) =>
		productions.find((p) => p.status === status);

	const targets: { row: ProductionRow | undefined; plan: Plan }[] = [
		// The show a producer is working on. Three acts and their changeovers come
		// to 140 minutes against the 150 the seeded schedule leaves between the
		// downbeat and curfew, so this one is deliberately clean — the warnings
		// have to be absent somewhere or they say nothing where they appear.
		{
			row: byStatus('confirmed'),
			plan: {
				sets: [30, 35, 45],
				changeover: 10,
				// Soundcheck runs in reverse of set order and hours earlier, which is
				// why it is manual rather than part of the walk.
				soundcheckOffsets: [-1, -1.5, -2]
			}
		},
		// A night that ran long. Two hours of sets plus changeovers against a
		// two-and-a-half-hour curfew, so the warning is real rather than contrived.
		{
			row: byStatus('closed'),
			plan: { sets: [45, 55, 70], changeover: 20, dj: true }
		},
		// Sets agreed, downbeat not. Every `scheduled_start_at` is null.
		{ row: byStatus('offered'), plan: { sets: [30, 45], changeover: 10 } }
	];

	const eventIds = targets.map((t) => t.row?.eventId).filter((id): id is string => !!id);
	const credits = eventIds.length
		? await db
				.select({ id: eventBand.id, eventId: eventBand.eventId, name: eventBand.name })
				.from(eventBand)
				.where(inArray(eventBand.eventId, eventIds))
				.orderBy(asc(eventBand.billingOrder))
		: [];

	const creditsFor = new Map<string, { id: string; name: string }[]>();
	for (const credit of credits) {
		const list = creditsFor.get(credit.eventId);
		if (list) list.push(credit);
		else creditsFor.set(credit.eventId, [credit]);
	}

	const rows: (typeof productionSlot.$inferInsert)[] = [];
	let uncredited = 0;
	let withoutTimes = 0;

	for (const { row, plan } of targets) {
		if (!row) continue;
		const bill = creditsFor.get(row.eventId) ?? [];
		if (bill.length === 0) continue;

		const acts = bill.slice(0, plan.sets.length);
		const planned = acts.map((act, i) => ({
			id: `${row.id}:${i}`,
			eventBandId: act.id as string | null,
			sortOrder: i + 1,
			createdAt: new Date(),
			setLengthMinutes: plan.sets[i] ?? 30,
			changeoverMinutes: plan.changeover,
			soundcheckAt:
				plan.soundcheckOffsets?.[i] != null && row.firstSetAt
					? new Date(row.firstSetAt.getTime() + plan.soundcheckOffsets[i]! * 3_600_000)
					: null
		}));

		if (plan.dj) {
			planned.push({
				id: `${row.id}:dj`,
				eventBandId: null,
				sortOrder: planned.length + 1,
				createdAt: new Date(),
				setLengthMinutes: 45,
				changeoverMinutes: 0,
				soundcheckAt: null
			});
			uncredited += 1;
		}

		const times = computeSetTimes(row.firstSetAt, planned);
		if (!row.firstSetAt) withoutTimes += planned.length;

		for (const slot of planned) {
			rows.push({
				productionId: row.id,
				eventBandId: slot.eventBandId,
				sortOrder: slot.sortOrder,
				setLengthMinutes: slot.setLengthMinutes,
				changeoverMinutes: slot.changeoverMinutes,
				scheduledStartAt: times.get(slot.id) ?? null,
				soundcheckAt: slot.soundcheckAt,
				techNotes: slot.eventBandId ? null : 'Runs off a laptop; one DI and a monitor.'
			});
		}
	}

	if (rows.length === 0) return { slots: 0, uncredited: 0, withoutTimes: 0 };

	// Eight columns a row, so twelve rows a statement stays under D1's
	// 100-parameter cap (8 × 12 = 96).
	await batchInsert(productionSlot, rows, 12);

	return { slots: rows.length, uncredited, withoutTimes };
}
