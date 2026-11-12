import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Which listings a month poster carries, in what order, marked as whose, and
 * whose sponsors. The SQL decides, so this runs against a migrated SQLite.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});
vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { monthCalendar, monthBounds } = await import('./calendar-service');

// November 2026 in club time; the 14th at 8 PM Pacific is 04:00 UTC on the 15th.
const NOV = (day: number, hourUtc = 4) => Math.floor(Date.UTC(2026, 10, day, hourUtc) / 1000);

function listing(
	id: string,
	source: string,
	startsAt: number,
	opts: { status?: string; groupId?: string; by?: string; imported?: boolean; kind?: string } = {}
) {
	sqlite.exec(
		`insert into event_listing (id, title, starts_at, ends_at, status, source, kind, group_id, created_by_user_id, import_source_id)
		 values ('${id}', '${id}', ${startsAt}, ${startsAt + 7200}, '${opts.status ?? 'published'}',
		 '${source}', '${opts.kind ?? 'show'}',
		 ${opts.groupId ? `'${opts.groupId}'` : 'null'}, '${opts.by ?? 'u-plain'}',
		 ${opts.imported ? "'feed-1'" : 'null'})`
	);
}

function credit(sponsorId: string, eventId: string, status = 'active') {
	sqlite.exec(
		`insert or ignore into organization (id, name) values ('${sponsorId}', '${sponsorId}')`
	);
	sqlite.exec(
		`insert into sponsorship (id, organization_id, title, status)
		 values ('${sponsorId}-${eventId}', '${sponsorId}', 'Deal', '${status}')`
	);
	sqlite.exec(
		`insert into sponsor_placement (id, sponsorship_id, event_id)
		 values ('p-${sponsorId}-${eventId}', '${sponsorId}-${eventId}', '${eventId}')`
	);
}

beforeEach(() => {
	sqlite.exec('pragma foreign_keys = off');
	for (const t of [
		'sponsor_placement',
		'sponsorship',
		'organization',
		'event_listing',
		'"group"',
		'user'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	sqlite.exec(`
		insert into user (id, name, email) values ('u-plain', 'Plain', 'plain@example.com');
		insert into "group" (id, kind, name, slug) values
			('g-plain', 'band', 'Plain Band', 'plain-band'),
			('g-club', 'club', 'Book Club', 'book-club'),
			('g-committee', 'committee', 'Booking Committee', 'booking-committee');
	`);
});

describe('monthCalendar', () => {
	it('lists the month in date order, marking CMC listings apart from the rest', async () => {
		listing('cmc-late', 'cmc', NOV(20));
		listing('cmc-early', 'cmc', NOV(2));
		listing('band', 'band', NOV(10), { groupId: 'g-plain' });
		listing('club', 'group', NOV(6), { groupId: 'g-club' });
		listing('comm-b', 'community', NOV(4));
		listing('comm-a', 'community', NOV(4));

		const cal = await monthCalendar('2026-11');
		expect(cal.events.map((e) => [e.id, e.madeBy])).toEqual([
			['cmc-early', 'cmc'],
			['comm-a', 'member'],
			['comm-b', 'member'],
			['club', 'member'],
			['band', 'member'],
			['cmc-late', 'cmc']
		]);
	});

	it('leaves out meetings and committee sessions, keeping other kinds', async () => {
		listing('show', 'cmc', NOV(2));
		listing('work-party', 'cmc', NOV(3), { kind: 'work_party' });
		listing('class', 'cmc', NOV(4), { kind: 'class' });
		listing('market', 'cmc', NOV(5), { kind: 'market' });
		listing('meeting', 'cmc', NOV(6), { kind: 'meeting' });
		listing('committee', 'group', NOV(7), { groupId: 'g-committee' });

		const cal = await monthCalendar('2026-11');
		expect(cal.events.map((e) => e.id)).toEqual(['show', 'work-party', 'class', 'market']);
	});

	it('leaves out unpublished, cancelled, imported and other-month listings', async () => {
		listing('kept', 'cmc', NOV(14));
		listing('draft', 'cmc', NOV(14), { status: 'draft' });
		listing('cancelled', 'cmc', NOV(14), { status: 'cancelled' });
		listing('pending', 'community', NOV(14), { status: 'pending_review' });
		listing('imported', 'community', NOV(14), { imported: true });
		listing('october', 'cmc', NOV(1, 6)); // 11 PM Oct 31 in club time
		listing('december', 'cmc', Math.floor(monthBounds('2026-12').from.getTime() / 1000));

		const cal = await monthCalendar('2026-11');
		expect(cal.events.map((e) => e.id)).toEqual(['kept']);
	});

	it("credits each sponsor of the month's listings once, and no one else's", async () => {
		listing('a', 'cmc', NOV(2));
		listing('b', 'band', NOV(3), { groupId: 'g-plain' });
		listing('elsewhere', 'cmc', NOV(14), { status: 'cancelled' });
		credit('Zed Co', 'a');
		credit('Zed Co', 'b');
		credit('Acme', 'b');
		credit('Pending Deal', 'a', 'prospect');
		credit('Cancelled Show Co', 'elsewhere');

		const cal = await monthCalendar('2026-11');
		expect(cal.sponsors.map((s) => s.name)).toEqual(['Acme', 'Zed Co']);
	});
});
