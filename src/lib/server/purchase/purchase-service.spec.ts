import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The receipt list, and the two things about it that are easy to get wrong.
 *
 * **Tickets are rows, not orders.** `ticket` has one row per pass and no order
 * table, so a four-ticket purchase reads as four purchases unless it is grouped
 * by `purchase_id`. A member who bought once and sees four lines will assume
 * they were charged four times.
 *
 * **Music is flagged and tickets are not.** The storefront can be switched off
 * while the ticketing that predates it keeps selling, so the page has to survive
 * one source going quiet rather than erroring or vanishing.
 */
type Row = Record<string, unknown>;

const state = { music: [] as Row[], tickets: [] as Row[], bandAudio: true };

function chain(rows: unknown[]) {
	const self: Record<string, unknown> = {};
	for (const key of ['from', 'where', 'orderBy', 'limit', 'innerJoin', 'leftJoin', 'groupBy']) {
		self[key] = () => self;
	}
	self.then = (resolve: (v: unknown) => void) => resolve(rows);
	return self;
}

vi.mock('$lib/server/db', () => ({
	db: { select: () => chain(state.tickets) }
}));

vi.mock('drizzle-orm', () => ({
	and: (...p: unknown[]) => `and(${p.join(',')})`,
	eq: (a: unknown, b: unknown) => `eq(${String(a)},${String(b)})`,
	inArray: (a: unknown, b: unknown) => `inArray(${String(a)},${String(b)})`,
	sql: Object.assign(
		(strings: TemplateStringsArray, ...values: unknown[]) =>
			strings.raw.join('?') + values.map(String).join(''),
		{ raw: (s: string) => s }
	)
}));

vi.mock('$lib/server/feature-flags', () => ({
	isFeatureEnabled: async () => state.bandAudio
}));

vi.mock('$lib/server/audio/purchase-service', () => ({
	listPurchasesForUser: async () => state.music
}));

const service = await import('./purchase-service');

/** One paid record, as the audio service hands it over. */
function musicRow(overrides: Row = {}): Row {
	return {
		purchaseId: 'mus-1',
		downloadToken: 'tok_abc',
		amountPaidCents: 1000,
		paidAt: new Date('2026-03-01T00:00:00Z'),
		releaseTitle: 'Marys Peak',
		releaseSlug: 'marys-peak',
		bandName: 'The Voltage Thieves',
		bandSlug: 'thevoltagethieves',
		...overrides
	};
}

/** One ticket order, already grouped by the database. */
function ticketRow(overrides: Row = {}): Row {
	return {
		purchaseId: 'tix-1',
		eventId: 'evt-1',
		eventTitle: 'Summer Solstice Set',
		eventStartsAt: new Date('2026-09-15T00:00:00Z'),
		quantity: 2,
		amountCents: 1600,
		purchasedAt: Math.floor(new Date('2026-02-01T00:00:00Z').getTime() / 1000),
		...overrides
	};
}

beforeEach(() => {
	state.music = [];
	state.tickets = [];
	state.bandAudio = true;
});

describe('listPurchasesForUser', () => {
	it('returns both kinds, tagged', async () => {
		state.music = [musicRow()];
		state.tickets = [ticketRow()];

		const rows = await service.listPurchasesForUser('u1');

		expect(rows.map((r) => r.kind)).toEqual(['music', 'ticket']);
	});

	it('sorts newest first, across both sources', async () => {
		// The whole reason they are merged in JS: two tables that cannot be
		// usefully unioned still have to interleave by date.
		state.music = [
			musicRow({ purchaseId: 'old', paidAt: new Date('2026-01-01T00:00:00Z') }),
			musicRow({ purchaseId: 'new', paidAt: new Date('2026-06-01T00:00:00Z') })
		];
		state.tickets = [ticketRow({ purchaseId: 'mid' })];

		const rows = await service.listPurchasesForUser('u1');

		expect(rows.map((r) => r.id)).toEqual(['new', 'mid', 'old']);
	});

	it('carries a ticket order’s quantity rather than one row per pass', async () => {
		state.tickets = [ticketRow({ quantity: 4, amountCents: 3200 })];

		const rows = await service.listPurchasesForUser('u1');

		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ kind: 'ticket', quantity: 4, amountCents: 3200 });
	});

	it('turns a grouped epoch back into a date', async () => {
		// `MIN(created_at)` comes back as a raw number, not the Date drizzle's
		// column mode would produce — the page formats it and would print NaN.
		state.tickets = [ticketRow()];

		const rows = await service.listPurchasesForUser('u1');

		expect(rows[0].purchasedAt).toBeInstanceOf(Date);
		expect(rows[0].purchasedAt?.toISOString()).toBe('2026-02-01T00:00:00.000Z');
	});

	it('drops music when the storefront is off, and keeps tickets', async () => {
		state.bandAudio = false;
		state.music = [musicRow()];
		state.tickets = [ticketRow()];

		const rows = await service.listPurchasesForUser('u1');

		expect(rows.map((r) => r.kind)).toEqual(['ticket']);
	});

	it('is empty rather than broken for somebody who has bought nothing', async () => {
		expect(await service.listPurchasesForUser('u1')).toEqual([]);
	});

	it('keeps a free record as a purchase', async () => {
		// A band can price a record at nothing and still want the sale on the
		// buyer's list — it is how they get the download link back.
		state.music = [musicRow({ amountPaidCents: 0 })];

		const rows = await service.listPurchasesForUser('u1');

		expect(rows[0]).toMatchObject({ kind: 'music', amountCents: 0 });
	});
});
