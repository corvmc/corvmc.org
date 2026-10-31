import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Day boundaries and listing filters are SQL, so this runs against a real SQLite. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { listMemberSummary, listRoomDays, listUpcomingShows } =
	await import('./staff-dashboard-service');

// Noon on Wednesday 28 October 2026 in Corvallis (PDT, UTC-7).
const NOW = new Date('2026-10-28T19:00:00Z');
const s = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

beforeEach(() => {
	for (const t of ['reservation', 'event_band', 'event_listing', 'production', 'project', 'user']) {
		sqlite.exec(`delete from "${t}"`);
	}
	sqlite.exec(
		`insert into user (id, name, email, email_verified) values ('u1', 'Ada', 'ada@example.com', 1)`
	);
});

describe('listRoomDays', () => {
	beforeEach(() => {
		const row = (id: string, status: string, from: string, to: string, lock = 'null') =>
			`('${id}', 'user', 'u1', 'u1', '${status}', ${s(from)}, ${s(to)}, ${lock})`;
		sqlite.exec(
			`insert into reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at, lock_code) values
				${row('late-last-night', 'confirmed', '2026-10-28T05:00:00Z', '2026-10-28T06:30:00Z')},
				${row('now', 'confirmed', '2026-10-28T18:00:00Z', '2026-10-28T20:00:00Z', "'1234'")},
				${row('this-evening', 'scheduled', '2026-10-29T01:00:00Z', '2026-10-29T03:00:00Z')},
				${row('dropped', 'cancelled', '2026-10-28T21:00:00Z', '2026-10-28T22:00:00Z')},
				${row('tomorrow', 'confirmed', '2026-10-29T20:00:00Z', '2026-10-29T22:00:00Z')},
				${row('friday', 'confirmed', '2026-10-30T20:00:00Z', '2026-10-30T22:00:00Z')}`
		);
	});

	it('splits today and tomorrow by club date, not UTC date', async () => {
		const days = await listRoomDays(NOW);
		expect(days.map((d) => d.date)).toEqual(['2026-10-28', '2026-10-29']);
		// 6pm PDT on the 28th is already the 29th in UTC.
		expect(days[0].reservations.map((r) => r.id)).toEqual(['now', 'this-evening']);
		expect(days[1].reservations.map((r) => r.id)).toEqual(['tomorrow']);
	});

	it('flags a code the lock has not confirmed while its booking is live', async () => {
		const [today] = await listRoomDays(NOW);
		const byId = Object.fromEntries(today.reservations.map((r) => [r.id, r]));
		expect(byId.now.doorCodeUnconfirmed).toBe(true);
		expect(byId['this-evening'].doorCodeUnconfirmed).toBe(false);
	});

	it('names who the room is held for', async () => {
		const [today] = await listRoomDays(NOW);
		expect(today.reservations[0].booker.title).toBe('Ada');
	});
});

describe('listUpcomingShows', () => {
	beforeEach(() => {
		sqlite.exec(`insert into project (id, name) values ('pr1', 'One'), ('pr2', 'Two')`);
		sqlite.exec(
			`insert into production (id, project_id, status, acts_wanted) values
				('p-offered', 'pr1', 'offered', 2),
				('p-confirmed', 'pr2', 'confirmed', null)`
		);
		const listing = (
			id: string,
			source: string,
			status: string,
			at: string,
			production = 'null',
			description = 'null'
		) =>
			`('${id}', '${id}', ${s(at)}, ${s(at) + 3 * 3600}, '${status}', '${source}', 'show', 'u1', ${production}, ${description})`;
		sqlite.exec(
			`insert into event_listing (id, title, starts_at, ends_at, status, source, kind, created_by_user_id, project_id, description) values
				${listing('unready', 'cmc', 'draft', '2026-10-30T03:00:00Z', "'pr1'")},
				${listing('ready-but-posterless', 'cmc', 'published', '2026-10-31T03:00:00Z', "'pr2'", "'A night'")},
				${listing('member-gig', 'community', 'pending_review', '2026-11-01T03:00:00Z')},
				${listing('private-draft', 'community', 'draft', '2026-11-01T03:00:00Z')},
				${listing('called-off', 'cmc', 'cancelled', '2026-11-02T03:00:00Z')},
				${listing('last-week', 'cmc', 'published', '2026-10-21T03:00:00Z')},
				${listing('next-month', 'cmc', 'published', '2026-11-20T03:00:00Z')}`
		);
		sqlite.exec(
			`insert into event_band (id, event_id, name) values ('eb1', 'unready', 'The Velvets')`
		);
	});

	it('lists the week ahead that staff may see, in date order', async () => {
		const shows = await listUpcomingShows(NOW);
		expect(shows.map((r) => r.id)).toEqual(['unready', 'ready-but-posterless', 'member-gig']);
	});

	it('says what each CMC show is still missing', async () => {
		const shows = await listUpcomingShows(NOW);
		const byId = Object.fromEntries(shows.map((r) => [r.id, r]));
		expect(byId.unready.productionStatus).toBe('offered');
		expect(byId.unready.blockers).toEqual([
			'the production is not confirmed yet',
			'there is no poster',
			'there is no description',
			'the bill needs 1 more act'
		]);
		expect(byId['ready-but-posterless'].blockers).toEqual(['there is no poster']);
		// A member's gig makes no promise on the collective's behalf.
		expect(byId['member-gig'].blockers).toEqual([]);
	});
});

describe('listMemberSummary', () => {
	it('counts joins from the first of the month in club time', async () => {
		sqlite.exec(`delete from user`);
		const row = (id: string, at: string) =>
			`('${id}', '${id}', '${id}@example.com', 1, ${s(at)}, ${s(at)})`;
		sqlite.exec(
			`insert into user (id, name, email, email_verified, created_at, updated_at) values
				${row('sept-30-late', '2026-10-01T06:00:00Z')},
				${row('oct-1', '2026-10-01T08:00:00Z')},
				${row('today', '2026-10-28T17:00:00Z')}`
		);
		const summary = await listMemberSummary(NOW);
		expect(summary.newThisMonth).toBe(2);
		expect(summary.recent.map((u) => u.id)).toEqual(['today', 'oct-1', 'sept-30-late']);
	});
});
