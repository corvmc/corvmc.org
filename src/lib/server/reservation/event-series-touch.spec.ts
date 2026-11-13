import { describe, it, expect, vi } from 'vitest';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { getTableName, is } from 'drizzle-orm';
import * as schema from '#lib/server/db/schema.js';

vi.mock('#lib/server/db/index.js', () => ({ db: {}, getRowCount: () => 0 }));

const { LISTING_RECORDS } = await import('./event-series-reschedule');

/** What the generator writes beside every occurrence; not a record anyone made. */
const GENERATED = ['event_group.event_id', 'ticket_sale.event_listing_id'];

const name = (col: { name: string; table: unknown }) =>
	`${getTableName(col.table as SQLiteTable)}.${col.name}`;

describe('what keeps an occurrence through a schedule change', () => {
	it('names every column that references a listing, as a record or as generated', () => {
		const references = Object.values(schema)
			.filter((t): t is SQLiteTable => is(t, SQLiteTable))
			.flatMap((table) =>
				getTableConfig(table)
					.foreignKeys.map((fk) => fk.reference())
					.filter((ref) => getTableName(ref.foreignTable) === 'event_listing')
					.flatMap((ref) => ref.columns.map(name))
			)
			// A listing's link to another listing is not a record about this one.
			.filter((col) => !col.startsWith('event_listing.'));

		const known = new Set([...LISTING_RECORDS.map(name), ...GENERATED]);
		expect(references.filter((col) => !known.has(col))).toEqual([]);
	});
});
