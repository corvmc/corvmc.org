import { describe, it, expect, beforeAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations } from './db/migrate-local';

/**
 * The copy of `event_listing`'s sale terms into `ticket_sale` (#1203).
 *
 * Prod D1 is canonical, so the copy has to be lossless. Run for real against a
 * scratch database migrated to head, with listings written the way the old
 * columns held them, then the copy re-run over them.
 */
const COPY = readFileSync(
	join(
		import.meta.dirname,
		'..',
		'migrations/20260923234834_ticket_sale_from_listing/migration.sql'
	),
	'utf8'
);

type SaleRow = {
	id: string;
	event_listing_id: string;
	group_id: string | null;
	enabled: number;
	price_cents: number | null;
	price_floor_cents: number;
	quantity: number | null;
};

describe('ticket_sale_from_listing', () => {
	let db: DatabaseSync;

	beforeAll(() => {
		const file = join(mkdtempSync(join(tmpdir(), 'corvmc-ticket-sale-')), 'd1.sqlite');
		applyMigrations(file);
		db = new DatabaseSync(file);
		db.exec('PRAGMA foreign_keys = OFF');
		const insert = db.prepare(`INSERT INTO event_listing
			(id, title, starts_at, ends_at, source, created_by_user_id,
			 ticketing_enabled, ticket_price, ticket_price_floor_cents, ticket_quantity)
			VALUES (?, 't', 1, 2, 'cmc', 'u', ?, ?, ?, ?)`);
		insert.run('sold', 1, 1500, 500, 80);
		insert.run('door-price', 0, 1000, 0, null);
		insert.run('free-rsvp', 1, null, 0, null);
		insert.run('plain', 0, null, 0, null);
		db.exec(COPY);
	});

	const sale = (id: string) =>
		db.prepare('SELECT * FROM ticket_sale WHERE event_listing_id = ?').get(id) as
			SaleRow | undefined;

	it('copies every term of a listing we sell', () => {
		expect(sale('sold')).toMatchObject({
			enabled: 1,
			price_cents: 1500,
			price_floor_cents: 500,
			quantity: 80,
			group_id: null
		});
	});

	it('keeps a door price that our checkout never sold', () => {
		expect(sale('door-price')).toMatchObject({ enabled: 0, price_cents: 1000 });
	});

	it('keeps a free listing that takes tickets', () => {
		expect(sale('free-rsvp')).toMatchObject({ enabled: 1, price_cents: null });
	});

	it('writes no row where every term was the default', () => {
		expect(sale('plain')).toBeUndefined();
	});

	it('refuses a second run rather than duplicating', () => {
		expect(() => db.exec(COPY)).toThrow(/UNIQUE|PRIMARY KEY/i);
	});

	it('drops nothing', () => {
		expect(COPY).not.toMatch(/\bDROP\b/i);
		expect(COPY).not.toMatch(/\bDELETE\b/i);
	});
});
