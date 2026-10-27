import { describe, it, expect, beforeEach, vi } from 'vitest';

/** The event's list, against a real SQLite: the filter and order are the point. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { createRsvp, cancelRsvp, listRsvpsForEvent, countRsvps } = await import('./rsvp-service');
const { eventListing } = await import('$lib/server/db/schema/event');
const { user } = await import('$lib/server/db/schema/authentication');
const { eventRsvp } = await import('$lib/server/db/schema/event-rsvp');

const START = new Date('2026-11-10T20:00:00Z');

beforeEach(async () => {
	sqlite.exec('delete from event_rsvp; delete from event_listing; delete from user;');
	await testDb.insert(user).values(
		['ada', 'bo', 'cy'].map((n) => ({
			id: `u-${n}`,
			name: n.toUpperCase(),
			email: `${n}@example.com`,
			emailVerified: false
		})) as never
	);
	for (const id of ['workshop', 'other']) {
		await testDb.insert(eventListing).values({
			id,
			title: `Event ${id}`,
			startsAt: START,
			endsAt: new Date(START.getTime() + 7_200_000),
			createdByUserId: 'u-ada',
			status: 'published',
			source: 'cmc',
			kind: 'class'
		} as never);
	}
});

async function rsvpAt(eventId: string, userId: string, at: number) {
	await testDb.insert(eventRsvp).values({
		eventId,
		userId,
		attendeeName: `Name ${userId}`,
		attendeeEmail: `${userId}@rsvp.test`,
		createdAt: new Date(at * 1000)
	});
}

describe('listRsvpsForEvent', () => {
	it("lists only this event's RSVPs, earliest first", async () => {
		await rsvpAt('workshop', 'u-bo', 2000);
		await rsvpAt('workshop', 'u-ada', 1000);
		await rsvpAt('other', 'u-cy', 500);

		const rows = await listRsvpsForEvent('workshop');
		expect(rows.map((r) => r.userId)).toEqual(['u-ada', 'u-bo']);
		expect(rows[0]).toMatchObject({
			name: 'Name u-ada',
			email: 'u-ada@rsvp.test',
			createdAt: new Date(1000 * 1000)
		});
	});

	it('is empty for an event nobody RSVPd to', async () => {
		expect(await listRsvpsForEvent('workshop')).toEqual([]);
	});
});

describe('createRsvp / cancelRsvp', () => {
	it('is idempotent, and cancelling removes only that member', async () => {
		const opts = { eventId: 'workshop', attendeeName: 'Ada', attendeeEmail: 'ada@example.com' };
		await createRsvp({ ...opts, userId: 'u-ada' });
		await createRsvp({ ...opts, userId: 'u-ada' });
		await createRsvp({ ...opts, userId: 'u-bo' });
		expect(await countRsvps('workshop')).toBe(2);

		await cancelRsvp('workshop', 'u-ada');
		expect((await listRsvpsForEvent('workshop')).map((r) => r.userId)).toEqual(['u-bo']);
	});
});
