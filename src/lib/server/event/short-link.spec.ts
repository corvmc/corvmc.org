/**
 * An event gets its short code on insert, whichever path writes the row, and
 * `/e/<code>` finds it again as printed, whatever case it is typed in.
 */
import { describe, it, expect, vi } from 'vitest';

const { testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});
vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

import { eventListing } from '#lib/server/db/schema/event.js';
import { normalizeShortCode } from '#lib/event-short-code.js';
import { eventIdByShortCode } from './short-link';

async function insertEvent(id: string) {
	const [row] = await testDb
		.insert(eventListing)
		.values({
			id,
			title: id,
			startsAt: new Date(1_800_000_000_000),
			endsAt: new Date(1_800_003_600_000),
			createdByUserId: 'u1'
		})
		.returning({ shortCode: eventListing.shortCode });
	return row.shortCode!;
}

describe('event short link', () => {
	it('gives each new event its own code the route accepts', async () => {
		const a = await insertEvent('a');
		const b = await insertEvent('b');
		expect(normalizeShortCode(a)).toBe(a);
		expect(a).not.toBe(b);
	});

	it('finds the event by its code, typed in any case', async () => {
		const code = await insertEvent('c');
		expect(await eventIdByShortCode(code)).toBe('c');
		expect(await eventIdByShortCode(` ${code.toUpperCase()} `)).toBe('c');
	});

	it('finds nothing for a code nobody holds or a malformed one', async () => {
		expect(await eventIdByShortCode('zzzzzz')).toBeNull();
		expect(await eventIdByShortCode('0o1li9')).toBeNull();
		expect(await eventIdByShortCode('../events')).toBeNull();
	});
});
