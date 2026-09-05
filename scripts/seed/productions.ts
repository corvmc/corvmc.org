import { production } from '../../src/lib/server/db/schema/production';
import { batchInsert } from './db';
import { type SeedEvent, type SeedUser } from './types';

/**
 * The ops record behind a CMC show.
 *
 * Every status the enum allows appears here, including the awkward ones: an
 * index whose status column only ever shows two values proves nothing about the
 * six-state machine underneath it, and `settled` and `closed` have no button to
 * reach them yet — the settlement worksheet and the close-out are later phases —
 * so seeding is the only way either renders at all.
 *
 * One CMC show is deliberately left **without** a production, because the empty
 * cell on the index and the "Add production" button on the event page are both
 * states that need to be reachable locally.
 */

/** Times relative to a show's own start, in hours. */
function schedule(startsAt: Date) {
	const at = (hours: number) => new Date(startsAt.getTime() + hours * 3_600_000);
	return {
		loadInAt: at(-3),
		soundcheckAt: at(-1.5),
		firstSetAt: at(0.5),
		curfewAt: at(3),
		loadOutBy: at(4)
	};
}

export async function seedProductions(events: SeedEvent[], users: SeedUser[]) {
	console.log('Seeding productions...');

	const producer = users[0]?.id ?? null;
	const now = new Date();

	const past = events.filter((e) => e.status === 'published' && e.startsAt < now);
	const upcoming = events.filter((e) => e.status === 'published' && e.startsAt >= now);
	const drafts = events.filter((e) => e.status === 'draft');
	const cancelled = events.filter((e) => e.status === 'cancelled');

	const rows: Record<string, unknown>[] = [];
	const used = new Set<string>();

	function add(event: SeedEvent | undefined, status: string, extras: Record<string, unknown> = {}) {
		if (!event || used.has(event.id)) return;
		used.add(event.id);
		rows.push({
			eventId: event.id,
			status,
			createdByUserId: producer,
			...extras
		});
	}

	// A night that has been run, settled and closed out — the far end of the
	// machine, and the only way `settled` and `closed` appear on screen at all.
	add(past[0], 'closed', {
		...schedule(past[0]?.startsAt ?? now),
		producerUserId: producer,
		billingNotes: '60/40 door split after the sound engineer.',
		hospitalityNotes: 'Two vegetarian meals, case of water, parking passes for the van.',
		internalNotes: 'Settled in cash the same night. Receipts in the folder.'
	});
	add(past[1], 'settled', {
		...schedule(past[1]?.startsAt ?? now),
		producerUserId: producer,
		internalNotes: 'Payouts sent; close-out still owed.'
	});
	add(past[2], 'completed', {
		...schedule(past[2]?.startsAt ?? now),
		producerUserId: producer
	});

	// The live work: one show fully advanced, one still waiting on an answer.
	add(upcoming[0], 'confirmed', {
		...schedule(upcoming[0]?.startsAt ?? now),
		producerUserId: producer,
		billingNotes: 'Guarantee against 70% of the door, whichever is greater.',
		hospitalityNotes: 'Green room is the office. Coffee, and somebody has to move the desk.',
		internalNotes: 'Backline is ours except the drum kit — headliner brings their own.'
	});
	add(upcoming[1], 'offered', {
		internalNotes: 'Offer out to the booking agent; no answer as of this morning.'
	});

	// A show somebody has started thinking about, with no times yet — the shape
	// a production has for most of its life.
	add(drafts[0], 'draft');

	// Cancelled listings drag their production back with them; seeding one that
	// way keeps the index honest about what a cancelled row looks like.
	add(cancelled[0], 'cancelled', { internalNotes: 'Headliner cancelled the tour.' });

	// upcoming[2] and everything after it stay production-less on purpose.

	await batchInsert(production, rows as never[]);

	return { productions: rows.length, withoutProduction: upcoming.length - 2 };
}
