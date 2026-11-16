import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The receipt list, against a real SQLite. **Tickets are rows, not orders**: a
 * four-ticket purchase reads as four purchases unless grouped by
 * `purchase_id`. **Music is flagged and tickets are not**: the page has to
 * survive the storefront being switched off.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

let bandAudio = true;
vi.mock('#lib/server/feature-flags.js', () => ({
	isFeatureEnabled: async () => bandAudio
}));

// Imported only through the audio purchase service, never called here.
vi.mock('#lib/server/stripe.js', () => ({ stripe: {} }));
vi.mock('#lib/server/finance/payment-service.js', () => ({ checkout: vi.fn() }));
vi.mock('#lib/server/event-bus/event-bus.js', () => ({
	domainEvents: { emit: vi.fn() }
}));

const service = await import('./purchase-service');

const at = (iso: string) => new Date(iso).getTime() / 1000;

function seedCatalogue() {
	sqlite.exec(
		`insert into "group" (id, kind, name, slug) values ('band-1', 'band', 'The Voltage Thieves', 'thevoltagethieves')`
	);
	sqlite.exec(
		`insert into audio_release (id, group_id, title, slug, status) values ('rel-1', 'band-1', 'Marys Peak', 'marys-peak', 'published')`
	);
	sqlite
		.prepare(
			`insert into event_listing (id, title, starts_at, ends_at, created_by_user_id) values ('evt-1', 'Summer Solstice Set', ?, ?, 'staff')`
		)
		.run(at('2026-09-15T00:00:00Z'), at('2026-09-15T03:00:00Z'));
}

function music(
	purchaseId: string,
	opts: {
		userId?: string;
		status?: string;
		paidAt?: string;
		amount?: number;
	} = {}
) {
	sqlite
		.prepare(
			`insert into release_purchase (id, release_id, user_id, buyer_email, purchase_id, amount_paid_cents,
			   platform_fee_cents, band_net_cents, download_token, status, paid_at)
			 values (?, 'rel-1', ?, 'u1@example.com', ?, ?, 0, 0, ?, ?, ?)`
		)
		.run(
			`row-${purchaseId}`,
			opts.userId ?? 'u1',
			purchaseId,
			opts.amount ?? 1000,
			`tok-${purchaseId}`,
			opts.status ?? 'paid',
			at(opts.paidAt ?? '2026-03-01T00:00:00Z')
		);
}

let code = 0;
function ticket(
	purchaseId: string,
	opts: {
		userId?: string;
		status?: string;
		createdAt?: string;
		price?: number;
		contribution?: number;
	} = {}
) {
	code += 1;
	sqlite
		.prepare(
			`insert into ticket (id, event_id, purchase_id, user_id, attendee_name, attendee_email, code,
			   status, unit_price_cents, contribution_cents, created_at)
			 values (?, 'evt-1', ?, ?, 'Ada', 'u1@example.com', ?, ?, ?, ?, ?)`
		)
		.run(
			`tix-${code}`,
			purchaseId,
			opts.userId ?? 'u1',
			`CODE${code}`,
			opts.status ?? 'valid',
			opts.price ?? 800,
			opts.contribution ?? 0,
			at(opts.createdAt ?? '2026-02-01T00:00:00Z')
		);
}

beforeEach(() => {
	bandAudio = true;
	for (const t of ['ticket', 'event_listing', 'release_purchase', 'audio_release', '"group"'])
		sqlite.exec(`delete from ${t}`);
	seedCatalogue();
});

describe('listPurchasesForUser', () => {
	it('returns both kinds, tagged', async () => {
		music('mus-1');
		ticket('tix-1');

		const rows = await service.listPurchasesForUser('u1');

		expect(rows.map((r) => [r.kind, r.id])).toEqual([
			['music', 'mus-1'],
			['ticket', 'tix-1']
		]);
		expect(rows[0]).toMatchObject({
			downloadToken: 'tok-mus-1',
			bandSlug: 'thevoltagethieves'
		});
	});

	it('sorts newest first, across both sources', async () => {
		// The reason they are merged in JS: two tables that cannot be unioned
		// still have to interleave by date.
		music('old', { paidAt: '2026-01-01T00:00:00Z' });
		music('new', { paidAt: '2026-06-01T00:00:00Z' });
		ticket('mid');

		const rows = await service.listPurchasesForUser('u1');

		expect(rows.map((r) => r.id)).toEqual(['new', 'mid', 'old']);
	});

	it('groups a ticket order into one row with its quantity and total', async () => {
		// The buyer's gift is recorded once, on the order's first ticket.
		ticket('order', { contribution: 500, createdAt: '2026-02-01T00:00:00Z' });
		for (let i = 0; i < 3; i++) ticket('order', { createdAt: '2026-02-01T00:00:05Z' });

		const rows = await service.listPurchasesForUser('u1');

		expect(rows).toEqual([
			expect.objectContaining({
				kind: 'ticket',
				id: 'order',
				quantity: 4,
				amountCents: 3700
			})
		]);
	});

	it('dates a ticket order by its first pass, as a Date', async () => {
		// `MIN(created_at)` comes back as a raw epoch; the page would print NaN.
		ticket('order', { createdAt: '2026-02-01T00:00:05Z' });
		ticket('order', { createdAt: '2026-02-01T00:00:00Z' });

		const [row] = await service.listPurchasesForUser('u1');

		expect(row.purchasedAt).toEqual(new Date('2026-02-01T00:00:00Z'));
	});

	it('leaves out cancelled tickets, unpaid records, and other members’ purchases', async () => {
		ticket('cancelled', { status: 'cancelled' });
		ticket('theirs', { userId: 'u2' });
		music('pending', { status: 'pending' });
		music('refunded', { status: 'refunded' });
		music('their-record', { userId: 'u2' });

		expect(await service.listPurchasesForUser('u1')).toEqual([]);
	});

	it('keeps pending and checked-in tickets', async () => {
		ticket('pending', { status: 'pending' });
		ticket('used', { status: 'checked_in' });

		const ids = (await service.listPurchasesForUser('u1')).map((r) => r.id).sort();

		expect(ids).toEqual(['pending', 'used']);
	});

	it('drops music when the storefront is off, and keeps tickets', async () => {
		bandAudio = false;
		music('mus-1');
		ticket('tix-1');

		const rows = await service.listPurchasesForUser('u1');

		expect(rows.map((r) => r.kind)).toEqual(['ticket']);
	});

	it('is empty rather than broken for somebody who has bought nothing', async () => {
		expect(await service.listPurchasesForUser('u1')).toEqual([]);
	});

	it('keeps a free record as a purchase', async () => {
		// How a buyer of a $0 record gets the download link back.
		music('free', { amount: 0 });

		const rows = await service.listPurchasesForUser('u1');

		expect(rows[0]).toMatchObject({ kind: 'music', amountCents: 0 });
	});
});
