import { describe, it, expect } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { eventPosterKeySql, eventListingColumns } from './event-columns';

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
