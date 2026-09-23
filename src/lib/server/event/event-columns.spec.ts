import { describe, it, expect } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/d1';
import { eventListing } from '$lib/server/db/schema/event';
import { eventPosterKeySql, eventListingColumns, shortOfActsSql } from './event-columns';

/**
 * The poster subquery, rendered and inspected — no database, per the repo's
 * "test SQL without a DB" note. The bug it guards against is silent: an
 * unqualified correlation binds to the inner table, returns nothing, and reads
 * as "this event has no poster" on every surface at once.
 */
const dialect = new SQLiteSyncDialect();
const rendered = dialect.sqlToQuery(eventPosterKeySql).sql;

describe('eventPosterKeySql', () => {
	it('correlates on the OUTER listing, table-qualified', () => {
		expect(rendered).toContain('"media_attachment"."attachable_id" = "event_listing"."id"');
		// `media_attachment` has an `id` of its own, so a bare one on the right-hand
		// side would be captured by the subquery's own FROM.
		expect(rendered).not.toMatch(/=\s*"?id"?\s*$/m);
	});

	it('reads the key off `media`, through the attachment', () => {
		expect(rendered).toContain('"media"."key"');
		expect(rendered).toContain('"media"."id" = "media_attachment"."media_id"');
	});

	it('is scoped to the poster slot on an event listing', () => {
		expect(rendered).toContain(`"media_attachment"."attachable_type" = 'event_listing'`);
		expect(rendered).toContain(`"media_attachment"."slot" = 'poster'`);
	});

	it('takes one row, so a duplicated slot cannot fan a listing out', () => {
		expect(rendered).toContain('LIMIT 1');
	});
});

describe('eventListingColumns', () => {
	it('overrides the mirror column rather than selecting it', () => {
		// The whole contract: `posterKey` on a listing row must be the subquery,
		// never `event_listing.poster_key`.
		expect(eventListingColumns.posterKey).toBe(eventPosterKeySql);
	});

	it('still carries the rest of the table', () => {
		for (const name of ['id', 'title', 'startsAt', 'status', 'source']) {
			expect(eventListingColumns).toHaveProperty(name);
		}
	});
});

describe('shortOfActsSql', () => {
	const short = dialect.sqlToQuery(shortOfActsSql).sql;

	it('correlates both halves on the OUTER listing', () => {
		expect(short).toContain('"p"."id" = "event_listing"."production_id"');
		expect(short).toContain('"eb"."event_id" = "event_listing"."id"');
	});

	it('compares the target against the credits on the bill', () => {
		expect(short).toContain('"p"."acts_wanted"');
		expect(short).toContain('count(*)');
		expect(short).toContain('>');
	});

	// The distinction the whole issue turns on: a bill with no target is not a
	// short bill, and `NULL > n` is NULL in SQLite, so it never matches.
	it('has no COALESCE that would make an unset target read as zero', () => {
		expect(short.toLowerCase()).not.toContain('coalesce');
		expect(short.toLowerCase()).not.toContain('ifnull');
	});
});

describe('eventListingColumns: the sale terms', () => {
	// A bare drizzle instance renders SQL with no binding.
	const sql = drizzle({} as never)
		.select(eventListingColumns)
		.from(eventListing)
		.toSQL()
		.sql.toLowerCase();

	it('reads every term from ticket_sale, correlated on the OUTER listing', () => {
		for (const column of ['enabled', 'price_cents', 'price_floor_cents', 'quantity']) {
			expect(sql).toContain(`"ticket_sale"."${column}"`);
		}
		expect(sql).toContain('"ticket_sale"."event_listing_id" = "event_listing"."id"');
	});

	it('never selects the retired event_listing columns', () => {
		// A single-table select renders its own columns unqualified.
		for (const column of [
			'ticketing_enabled',
			'ticket_price',
			'ticket_price_floor_cents',
			'ticket_quantity'
		]) {
			expect(sql).not.toContain(`"${column}"`);
		}
		expect(eventListingColumns).not.toHaveProperty('legacyTicketingEnabled');
	});

	it('keeps the row shape its readers already use', () => {
		for (const name of [
			'ticketingEnabled',
			'ticketPrice',
			'ticketPriceFloorCents',
			'ticketQuantity'
		]) {
			expect(eventListingColumns).toHaveProperty(name);
		}
	});

	it('reads a listing with no sale row as not on sale, with a floor of zero', () => {
		expect(sql).toMatch(/coalesce\(\(select "ticket_sale"."enabled"/);
		expect(sql).toMatch(/coalesce\(\(select "ticket_sale"."price_floor_cents"/);
	});
});
