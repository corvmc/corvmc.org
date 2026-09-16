import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Recording a payout, against a real SQLite.
 *
 * The part worth a database is the ledger half: how much of a payout comes out
 * of the pool the buyers designated and how much is the collective's own
 * money. That split is a read of `poolBalanceCents` against live rows, and a
 * mocked `db` would agree with either answer.
 */

/**
 * The whole schema, replayed from the committed migrations.
 *
 * Not `ddlFor(table)` as three sibling specs use: that lifts the `CREATE TABLE`
 * out of the migration that last created it, and `event` was renamed to
 * `event_listing` after creation, so it finds nothing. Replaying every
 * migration is what a rename survives, and it is what `db:migrate:local` does.
 */
const { sqlite, testDb } = vi.hoisted(() => {
	/* eslint-disable @typescript-eslint/no-require-imports */
	const { readFileSync, globSync } = require('node:fs') as typeof import('node:fs');
	const Database = require('better-sqlite3') as typeof import('better-sqlite3');
	const { drizzle } =
		require('drizzle-orm/better-sqlite3') as typeof import('drizzle-orm/better-sqlite3');
	/* eslint-enable @typescript-eslint/no-require-imports */

	const sqlite = new Database(':memory:');

	for (const file of globSync('migrations/*/migration.sql').sort()) {
		for (const statement of readFileSync(file, 'utf8')
			.split('--> statement-breakpoint')
			.map((s: string) => s.trim())
			.filter(Boolean)) {
			sqlite.exec(statement);
		}
	}

	// After the replay, not before: a table rebuild toggles this pragma back on
	// as its last statement. Off for the same reason the sibling specs turn it
	// off — these are aggregate queries, and seeding every referenced parent
	// row would test nothing extra.
	sqlite.pragma('foreign_keys = OFF');

	// `drizzle({ client })`, not `drizzle(client)` — the positional overload is
	// gone in drizzle 1.0 and a raw Database is read as a config object, which
	// quietly opens a second, empty database.
	return { sqlite, testDb: drizzle({ client: sqlite }) };
});

vi.mock('$lib/server/db', () => ({
	db: testDb,
	getRowCount: (result: unknown) => (result as { changes?: number })?.changes ?? 0
}));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

const { recordSlotPayout, getSettlement, PayoutError } = await import('./settlement-service');
const { poolBalanceCents, totalsByKindAndCategory } =
	await import('$lib/server/finance/financial-entry-service');

const EVENT = 'evt-1';
const PROD = 'prod-1';
const SLOT = 'slot-1';
const STAFF = 'usr-staff';

const YEAR = { from: new Date('2020-01-01'), to: new Date('2030-01-01') };

async function seed(opts: { poolCents?: number; guaranteeCents?: number | null } = {}) {
	const { user } = await import('$lib/server/db/schema/authentication');
	const { eventListing } = await import('$lib/server/db/schema/event');
	const { production, productionSlot } = await import('$lib/server/db/schema/production');
	const { financialEntry } = await import('$lib/server/db/schema/financial');

	await testDb
		.insert(user)
		.values({ id: STAFF, name: 'Staff', email: 's@example.com', emailVerified: false } as never);
	await testDb.insert(eventListing).values({
		id: EVENT,
		title: 'A show',
		startsAt: new Date('2026-03-04T02:00:00Z'),
		endsAt: new Date('2026-03-04T05:00:00Z'),
		createdByUserId: STAFF,
		status: 'published',
		source: 'cmc',
		kind: 'show'
	} as never);
	await testDb
		.insert(production)
		.values({ id: PROD, eventId: EVENT, status: 'completed' } as never);
	await testDb.insert(productionSlot).values({
		id: SLOT,
		productionId: PROD,
		sortOrder: 1,
		setLengthMinutes: 40,
		guaranteeCents: opts.guaranteeCents ?? null
	} as never);

	// What ticket buyers designated to the acts, as the checkout listener writes it.
	if (opts.poolCents) {
		await testDb.insert(financialEntry).values({
			amountCents: opts.poolCents,
			kind: 'pass_through',
			category: 'act_payout',
			occurredAt: new Date('2026-03-01T00:00:00Z'),
			settlement: 'stripe',
			settlementGroup: EVENT,
			subjectType: 'ticket',
			subjectId: 'tkt-1',
			description: 'Acts share'
		} as never);
	}
}

beforeEach(async () => {
	for (const t of ['financial_entry', 'production_slot', 'production', 'event_listing', 'user']) {
		sqlite.exec(`delete from ${t}`);
	}
});

describe('what a payout does to the pool', () => {
	it('draws the whole thing from the pool when the pool covers it', async () => {
		await seed({ poolCents: 70_000 });
		await recordSlotPayout(SLOT, 50_000, STAFF);

		// 700 in, 500 out: 200 still held for the acts.
		expect(await poolBalanceCents(EVENT)).toBe(20_000);
	});

	it('closes the pool exactly when the payout matches it', async () => {
		await seed({ poolCents: 70_000 });
		await recordSlotPayout(SLOT, 70_000, STAFF);
		expect(await poolBalanceCents(EVENT)).toBe(0);
	});

	/**
	 * The guarantee-on-a-soft-night case, and the reason this is two rows. The
	 * excess is the collective spending its own money, not passing somebody
	 * else's through — booking it all as pass-through would drive the pool
	 * negative, which already means a refund the collective absorbed.
	 */
	it('splits an over-pool payout into the pool and a guarantee top-up', async () => {
		await seed({ poolCents: 30_000, guaranteeCents: 50_000 });
		await recordSlotPayout(SLOT, 50_000, STAFF);

		expect(await poolBalanceCents(EVENT)).toBe(0);

		const totals = await totalsByKindAndCategory(YEAR);
		expect(totals).toContainEqual({
			kind: 'spent',
			category: 'act_guarantee',
			totalCents: 20_000
		});
	});

	it('is all top-up when nothing was designated', async () => {
		await seed({ guaranteeCents: 25_000 });
		await recordSlotPayout(SLOT, 25_000, STAFF);

		expect(await poolBalanceCents(EVENT)).toBe(0);
		const totals = await totalsByKindAndCategory(YEAR);
		expect(totals).toContainEqual({
			kind: 'spent',
			category: 'act_guarantee',
			totalCents: 25_000
		});
	});

	/** A donated set is paid, at zero. It must not write a ledger row. */
	it('writes nothing for a zero payout, but still marks the act settled', async () => {
		await seed({ poolCents: 10_000 });
		await recordSlotPayout(SLOT, 0, STAFF);

		expect(await poolBalanceCents(EVENT)).toBe(10_000);
		const settlement = await getSettlement(EVENT);
		expect(settlement?.acts[0].paidCents).toBe(0);
		expect(settlement?.unpaidActCount).toBe(0);
	});
});

describe('what the worksheet reports back', () => {
	it('carries the paid figure and the outstanding count', async () => {
		await seed({ poolCents: 40_000 });

		const before = await getSettlement(EVENT);
		expect(before?.acts[0].paidCents).toBeNull();
		expect(before?.unpaidActCount).toBe(1);
		expect(before?.paidTotalCents).toBe(0);

		await recordSlotPayout(SLOT, 40_000, STAFF);

		const after = await getSettlement(EVENT);
		expect(after?.acts[0].paidCents).toBe(40_000);
		expect(after?.unpaidActCount).toBe(0);
		expect(after?.paidTotalCents).toBe(40_000);
	});
});

describe('what it refuses', () => {
	it('refuses a second payout rather than double-paying', async () => {
		await seed({ poolCents: 40_000 });
		await recordSlotPayout(SLOT, 20_000, STAFF);

		await expect(recordSlotPayout(SLOT, 20_000, STAFF)).rejects.toBeInstanceOf(PayoutError);
		// And the first one is untouched.
		expect(await poolBalanceCents(EVENT)).toBe(20_000);
	});

	it('refuses a negative amount', async () => {
		await seed({ poolCents: 40_000 });
		await expect(recordSlotPayout(SLOT, -100, STAFF)).rejects.toBeInstanceOf(PayoutError);
	});

	/** Closed is terminal; a correction is a reversing entry, not an edit. */
	it('refuses once the show is closed', async () => {
		await seed({ poolCents: 40_000 });
		const { production } = await import('$lib/server/db/schema/production');
		const { eq } = await import('drizzle-orm');
		await testDb.update(production).set({ status: 'closed' }).where(eq(production.id, PROD));

		await expect(recordSlotPayout(SLOT, 40_000, STAFF)).rejects.toBeInstanceOf(PayoutError);
	});

	it('refuses a slot that is no longer on the bill', async () => {
		await seed({ poolCents: 40_000 });
		await expect(recordSlotPayout('slot-gone', 100, STAFF)).rejects.toBeInstanceOf(PayoutError);
	});
});
