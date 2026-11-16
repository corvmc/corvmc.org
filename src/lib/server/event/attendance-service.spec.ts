import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Session attendance against a real SQLite: the counts and the diff are SQL. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { listSessionAttendance, setSessionAttendance, countAttendanceByMember } =
	await import('./attendance-service');

function session(id: string, groupId: string) {
	sqlite.exec(
		`insert into event_listing (id, title, starts_at, ends_at, status, source, kind, group_id, created_by_user_id)
		 values ('${id}', 'Session ${id}', 1000, 2000, 'published', 'group', 'meeting', '${groupId}', 'lead')`
	);
	sqlite.exec(`insert into event_group (event_id, group_id) values ('${id}', '${groupId}')`);
}

beforeEach(() => {
	for (const t of [
		'event_attendance',
		'event_rsvp',
		'event_group',
		'event_listing',
		'group_member'
	])
		sqlite.exec(`delete from ${t}`);
	sqlite.exec('delete from "group"');
	sqlite.exec('delete from user');
	sqlite.exec(
		`insert into user (id, name, email) values
			('lead', 'Lee', 'lee@example.com'),
			('ada', 'Ada', 'ada@example.com'),
			('bo', 'Bo', 'bo@example.com'),
			('guest', 'Gus', 'gus@example.com'),
			('stranger', 'Sam', 'sam@example.com')`
	);
	sqlite.exec(
		`insert into "group" (id, name, slug, kind) values
			('club', 'Film Club', 'film-club', 'club'),
			('other', 'Other Club', 'other-club', 'club')`
	);
	sqlite.exec(
		`insert into group_member (group_id, user_id, role, status) values
			('club', 'lead', 'admin', 'active'),
			('club', 'ada', 'member', 'active'),
			('club', 'bo', 'member', 'pending')`
	);
	session('s1', 'club');
	session('s2', 'club');
	session('o1', 'other');
	// Gus is not on the roster, but RSVPed.
	sqlite.exec(
		`insert into event_rsvp (event_id, user_id, attendee_name, attendee_email)
		 values ('s1', 'guest', 'Gus', 'gus@example.com')`
	);
});

const mark = (eventId: string, userIds: string[]) =>
	setSessionAttendance({ eventId, groupId: 'club', userIds, markedByUserId: 'lead' });

const marked = (eventId: string) =>
	(
		sqlite
			.prepare(`select user_id from event_attendance where event_id = ? order by user_id`)
			.all(eventId) as { user_id: string }[]
	).map((r) => r.user_id);

describe('who a lead can mark', () => {
	it('is the active roster plus the RSVPs', async () => {
		const rows = await listSessionAttendance('s1', 'club');
		expect(rows.map((r) => r.userId).sort()).toEqual(['ada', 'guest', 'lead']);
		expect(rows.find((r) => r.userId === 'guest')?.rsvped).toBe(true);
		expect(rows.find((r) => r.userId === 'ada')?.rsvped).toBe(false);
	});
});

describe('marking attendance', () => {
	it('records a walk-in from the roster with no RSVP', async () => {
		await mark('s1', ['ada']);
		expect(marked('s1')).toEqual(['ada']);
		expect(sqlite.prepare(`select count(*) n from event_rsvp where user_id = 'ada'`).get()).toEqual(
			{ n: 0 }
		);
	});

	it('replaces the set: unticked people are unmarked', async () => {
		await mark('s1', ['ada', 'guest']);
		await mark('s1', ['guest']);
		expect(marked('s1')).toEqual(['guest']);
		await mark('s1', []);
		expect(marked('s1')).toEqual([]);
	});

	it('drops an id that is neither on the roster nor an RSVP', async () => {
		await mark('s1', ['ada', 'stranger', 'bo']);
		expect(marked('s1')).toEqual(['ada']);
	});

	it('stays under D1’s parameter cap on a large roster', async () => {
		const ids = Array.from({ length: 150 }, (_, i) => `m${i}`);
		sqlite.exec(
			`insert into user (id, name, email) values ${ids.map((id) => `('${id}', '${id}', '${id}@x')`).join(',')}`
		);
		sqlite.exec(
			`insert into group_member (group_id, user_id, role, status) values ${ids.map((id) => `('club', '${id}', 'member', 'active')`).join(',')}`
		);
		await mark('s1', ids);
		expect(marked('s1')).toHaveLength(150);
		await mark('s1', []);
		expect(marked('s1')).toEqual([]);
	});
});

describe('attendance counts', () => {
	it('counts each member’s sessions in this group only', async () => {
		await mark('s1', ['ada', 'lead']);
		await mark('s2', ['ada']);
		sqlite.exec(`insert into event_attendance (event_id, user_id) values ('o1', 'ada')`);
		const counts = await countAttendanceByMember('club');
		expect(counts.get('ada')).toBe(2);
		expect(counts.get('lead')).toBe(1);
		expect(counts.has('guest')).toBe(false);
	});
});
