import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';
import { computeSplit, suggestedShareCents } from '$lib/finance/split';
import { AUDIO_PLATFORM_FEE_BPS } from '$lib/config';

/**
 * The collective's own sales report, and the one thing it must never get wrong.
 *
 * `salesTotals` reports three figures beside a gross — to bands, card fees, and
 * what CMC kept — and they have to reconcile, because a staff member reading
 * them is deciding whether a refusable cut is paying for itself. It shipped
 * subtracting card processing from the collective's column a *second* time:
 * `platform_fee_cents` already stores the net share the buyer saw on the split
 * bar, so the fee had come off before the row was ever written. On the seeded
 * data that read as $79.13 to bands, $5.45 in fees and $4.20 kept against a
 * $94.23 gross — $5.45 short, and nothing failed.
 *
 * No unit test over the service would have caught it: the arithmetic was
 * self-consistent, just wrong about what the column meant. What catches it is
 * asserting the columns add up to the gross.
 */
type Row = Record<string, unknown>;

const state = { results: [] as unknown[][] };

function chain(rows: unknown[]) {
	const self: Record<string, unknown> = {};
	for (const key of ['from', 'where', 'orderBy', 'limit', 'innerJoin', 'leftJoin', 'groupBy']) {
		self[key] = () => self;
	}
	self.then = (resolve: (v: unknown) => void) => resolve(rows);
	return self;
}

vi.mock('$lib/server/db', () => ({
	db: { select: () => chain(state.results.shift() ?? []) }
}));

vi.mock('drizzle-orm', () => ({
	and: (...p: unknown[]) => `and(${p.join(',')})`,
	count: () => 'count()',
	desc: (a: unknown) => `desc(${String(a)})`,
	eq: (a: unknown, b: unknown) => `eq(${String(a)},${String(b)})`,
	isNull: (a: unknown) => `isNull(${String(a)})`,
	sql: Object.assign(
		(strings: TemplateStringsArray, ...values: unknown[]) =>
			strings.raw.join('?') + values.map(String).join(''),
		{ raw: (s: string) => s }
	)
}));

const service = await import('./staff-audio-service');

/** One sale, priced through the same module the buyer's bar renders from. */
function sale(totalCents: number, coverFees = false, bps = AUDIO_PLATFORM_FEE_BPS) {
	const divisible = computeSplit({ totalCents, shareCents: 0, coverFees }).remainderCents;
	const s = computeSplit({
		totalCents,
		shareCents: suggestedShareCents(divisible, bps),
		coverFees
	});
	return {
		amountPaidCents: s.chargeCents,
		bandNetCents: s.remainderCents,
		platformFeeCents: s.shareCents
	};
}

/** Queue the aggregate row and the per-sale amounts `salesTotals` reads. */
function queueSales(sales: ReturnType<typeof sale>[]) {
	const sum = (k: keyof ReturnType<typeof sale>) => sales.reduce((t, s) => t + s[k], 0);
	state.results = [
		[
			{
				sales: sales.length,
				gross: sum('amountPaidCents'),
				toBands: sum('bandNetCents'),
				toCollective: sum('platformFeeCents'),
				free: sales.filter((s) => s.amountPaidCents === 0).length
			} as Row
		],
		sales.map((s) => ({ amount: s.amountPaidCents }))
	];
}

describe('salesTotals', () => {
	it('reconciles: bands + collective + card fees is the gross', async () => {
		queueSales([
			sale(1000),
			sale(1000, true),
			sale(500),
			sale(2500, false, 2500),
			sale(1000, false, 0)
		]);

		const t = await service.salesTotals();

		// The assertion the double-subtraction failed. Any cent that goes missing
		// from one column has to show up in another.
		expect(t.toBandsCents + t.toCollectiveCents + t.feesCents).toBe(t.grossCents);
	});

	it('reports the collective’s take net of processing, not gross of it', async () => {
		// A single $10 sale at the suggested 10%: 59¢ to the card, 94¢ kept.
		queueSales([sale(1000)]);

		const t = await service.salesTotals();

		expect(t.grossCents).toBe(1000);
		expect(t.feesCents).toBe(59);
		expect(t.toCollectiveCents).toBe(94);
		expect(t.toBandsCents).toBe(847);
	});

	it('keeps the realised take honest when buyers refuse the cut', async () => {
		// Two sales, one with the collective dragged to zero. The realised rate has
		// to fall, and must never go negative — which is what it did when the fee
		// was subtracted from a share that was already zero.
		queueSales([sale(1000), sale(1000, false, 0)]);

		const t = await service.salesTotals();

		expect(t.toCollectiveCents).toBe(94);
		expect(t.realisedTakeBps).toBe(470);
		expect(t.toBandsCents + t.toCollectiveCents + t.feesCents).toBe(t.grossCents);
	});

	it('is all zeroes with nothing sold, rather than a division by zero', async () => {
		queueSales([]);

		const t = await service.salesTotals();

		expect(t).toMatchObject({ sales: 0, grossCents: 0, feesCents: 0, realisedTakeBps: 0 });
	});

	it('counts free downloads without letting them distort the split', async () => {
		queueSales([sale(0), sale(1000)]);

		const t = await service.salesTotals();

		expect(t.freeSales).toBe(1);
		expect(t.sales).toBe(2);
		expect(t.toBandsCents + t.toCollectiveCents + t.feesCents).toBe(t.grossCents);
	});
});
