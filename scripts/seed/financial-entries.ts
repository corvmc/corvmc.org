import { financialEntry } from '../../src/lib/server/db/schema/financial';
import { calculateProcessingFee } from '../../src/lib/finance/fees';
import { db } from './db';
import { type SeedReservation, type SeedUser } from './types';
import { randomInt } from './util';

/**
 * The financial record, seeded from what the other seeds already created.
 *
 * Written as the real write paths will write it — a sale is three or four rows,
 * not one — so a report built against this fixture is built against the shape
 * production will have. See `docs/specs/financial-record-spec.md`.
 */
export async function seedFinancialEntries(users: SeedUser[], reservations: SeedReservation[]) {
	console.log('Seeding financial entries...');
	const rows: (typeof financialEntry.$inferInsert)[] = [];

	const paid = reservations
		.filter((r) => ['completed', 'confirmed'].includes(r.status))
		.slice(0, 20);

	// Practice-room hours: the collective keeps the whole thing, less the card.
	for (const r of paid) {
		const hours = Math.round(((r.endsAt.getTime() - r.startsAt.getTime()) / 3600000) * 2) / 2;
		const grossCents = hours * 1500;
		if (grossCents <= 0) continue;
		const feeCents = calculateProcessingFee(grossCents);

		rows.push({
			amountCents: grossCents,
			kind: 'earned',
			category: 'reservation',
			occurredAt: r.startsAt,
			settlement: 'stripe',
			stripePaymentRecordId: `pi_seed_${r.id.slice(0, 8)}`,
			subjectType: 'reservation',
			subjectId: r.id,
			userId: r.createdByUserId,
			description: `Practice room, ${hours} hrs`
		});
		rows.push({
			amountCents: -feeCents,
			kind: 'spent',
			category: 'card_fees',
			occurredAt: r.startsAt,
			settlement: 'stripe',
			stripePaymentRecordId: `pi_seed_${r.id.slice(0, 8)}`,
			subjectType: 'reservation',
			subjectId: r.id,
			description: 'Card processing'
		});
	}

	// One settled show, so a pool that nets to zero exists to read. Three acts on
	// an $840 pool with one on a $400 guarantee: the guarantee top-up is spend,
	// never pass-through, because it never passed through anything.
	const donor = users[0]?.id ?? null;
	const showAt = new Date(Date.now() - 21 * 86_400_000);
	const designated = [28_000, 28_000, 28_000];
	for (const [i, cents] of designated.entries()) {
		rows.push({
			amountCents: cents,
			kind: 'pass_through',
			category: 'act_payout',
			occurredAt: showAt,
			settlement: 'stripe',
			settlementGroup: 'seed-production-1',
			subjectType: 'ticket',
			subjectId: `seed-ticket-pool-${i}`,
			description: 'Door, designated to the acts'
		});
		rows.push({
			amountCents: -cents,
			kind: 'pass_through',
			category: 'act_payout',
			occurredAt: showAt,
			settlement: 'cash',
			settlementGroup: 'seed-production-1',
			subjectType: 'production',
			subjectId: 'seed-production-1',
			description: `Paid act ${i + 1}`
		});
	}
	rows.push({
		amountCents: -12_000,
		kind: 'spent',
		category: 'act_guarantee',
		occurredAt: showAt,
		settlement: 'cash',
		settlementGroup: 'seed-production-1',
		subjectType: 'production',
		subjectId: 'seed-production-1',
		description: 'Guarantee above the door split'
	});

	// A donated amp, so the in-kind total is not empty and a report that wrongly
	// adds it to revenue is visibly wrong rather than invisibly right.
	rows.push({
		amountCents: 45_000,
		kind: 'in_kind',
		category: 'equipment',
		occurredAt: new Date(Date.now() - 60 * 86_400_000),
		settlement: 'none',
		subjectType: 'acquisition',
		subjectId: 'seed-acquisition-amp',
		userId: donor,
		description: 'Donated bass amp, fair value'
	});

	// A free ticket. Without the $0 row, three comps are indistinguishable from
	// seven sales.
	rows.push({
		amountCents: 0,
		kind: 'earned',
		category: 'ticket_sales',
		occurredAt: showAt,
		settlement: 'none',
		subjectType: 'ticket',
		subjectId: `seed-ticket-free-${randomInt(100, 999)}`,
		description: 'Ticket, on the house'
	});

	// D1 caps a statement at 100 bound parameters and these rows are 16 columns
	// wide, so chunk rather than sending one insert.
	for (let i = 0; i < rows.length; i += 6) {
		await db.insert(financialEntry).values(rows.slice(i, i + 6));
	}

	return rows;
}
