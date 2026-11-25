import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The Crew box's rows (#3270), on a real SQLite: an event's own live shifts,
 * each naming the people who hold a place on it.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { eventCrew } = await import('./event-crew');

const at = (hours: number) => Math.floor(Date.UTC(2026, 5, 15) / 1000) + hours * 3600;

beforeEach(() => {
	for (const table of [
		'volunteer_signup',
		'volunteer_shift',
		'work_order',
		'event_listing',
		'volunteer_role',
		'user'
	]) {
		sqlite.exec(`delete from ${table}`);
	}
	sqlite.exec(`
		insert into user (id, name, email) values
			('u1', 'Ada', 'ada@example.com'), ('u2', 'Bo', 'bo@example.com'), ('u3', 'Cy', 'cy@example.com');
		insert into volunteer_role (id, name) values ('door', 'Door'), ('host', 'Host');
		insert into event_listing (id, title, starts_at, ends_at, status, source, kind, created_by_user_id) values
			('fri', 'Friday', ${at(24)}, ${at(28)}, 'published', 'cmc', 'show', 'u1'),
			('sat', 'Saturday', ${at(48)}, ${at(52)}, 'published', 'cmc', 'show', 'u1');
		insert into work_order (id, volunteer_role_id, event_id, title) values
			('fri-door', 'door', 'fri', null),
			('fri-host', 'host', 'fri', 'Night host'),
			('sat-door', 'door', 'sat', null);
		insert into work_order (id, volunteer_role_id, event_id, cancelled_at) values
			('fri-off', 'door', 'fri', ${at(-1)});
		insert into volunteer_shift (id, work_order_id, starts_at, ends_at, capacity) values
			('s-door', 'fri-door', ${at(23)}, ${at(28)}, 2),
			('s-host', 'fri-host', ${at(22)}, ${at(28)}, 1),
			('s-sat', 'sat-door', ${at(47)}, ${at(52)}, 1),
			('s-off', 'fri-off', ${at(23)}, ${at(28)}, 1);
		insert into volunteer_shift (id, work_order_id, starts_at, ends_at, capacity, cancelled_at) values
			('s-called-off', 'fri-door', ${at(30)}, ${at(32)}, 1, ${at(-1)});
		insert into volunteer_signup (id, shift_id, user_id, status) values
			('su1', 's-door', 'u1', 'confirmed'),
			('su2', 's-door', 'u2', 'cancelled'),
			('su3', 's-host', 'u3', 'claimed');
	`);
});

describe('eventCrew', () => {
	it("lists the event's own live shifts in start order, labelled by title or role", async () => {
		const crew = await eventCrew('fri');
		expect(crew.map((s) => [s.shiftId, s.label])).toEqual([
			['s-host', 'Night host'],
			['s-door', 'Door']
		]);
	});

	it('names only the people who hold a place', async () => {
		const crew = await eventCrew('fri');
		const door = crew.find((s) => s.shiftId === 's-door');
		expect(door).toMatchObject({ capacity: 2, people: [{ userId: 'u1', name: 'Ada' }] });
	});

	it('returns nothing for an event with no shifts', async () => {
		expect(await eventCrew('nope')).toEqual([]);
	});
});
