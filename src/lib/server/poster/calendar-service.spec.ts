import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Which listings a month poster carries, in which block, and whose sponsors.
 * The SQL decides the facts, so this runs against a migrated SQLite.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});
vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { calendarBlock, monthCalendar, monthBounds } = await import('./calendar-service');

// November 2026 in club time; the 14th at 8 PM Pacific is 04:00 UTC on the 15th.
const NOV = (day: number, hourUtc = 4) => Math.floor(Date.UTC(2026, 10, day, hourUtc) / 1000);

function listing(
	id: string,
	source: string,
	startsAt: number,
	opts: { status?: string; groupId?: string; by?: string; imported?: boolean } = {}
) {
	sqlite.exec(
		`insert into event_listing (id, title, starts_at, ends_at, status, source, group_id, created_by_user_id, import_source_id)
		 values ('${id}', '${id}', ${startsAt}, ${startsAt + 7200}, '${opts.status ?? 'published'}',
		 '${source}', ${opts.groupId ? `'${opts.groupId}'` : 'null'}, '${opts.by ?? 'u-plain'}',
		 ${opts.imported ? "'feed-1'" : 'null'})`
	);
}

function credit(sponsorId: string, eventId: string, status = 'active') {
	sqlite.exec(`insert or ignore into sponsor (id, name) values ('${sponsorId}', '${sponsorId}')`);
	sqlite.exec(
		`insert into sponsorship (id, sponsor_id, title, status)
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
		'sponsor',
		'event_listing',
		'group_member',
		'"group"',
		'user'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	sqlite.exec(`
		insert into user (id, name, email, subscription) values
			('u-plain', 'Plain', 'plain@example.com', null),
			('u-sus', 'Sus', 'sus@example.com', '{"status":"active"}'),
			('u-left', 'Left', 'left@example.com', '{"status":"active"}');
		insert into "group" (id, kind, name, slug) values
			('g-sus', 'band', 'Sus Band', 'sus-band'),
			('g-plain', 'band', 'Plain Band', 'plain-band'),
			('g-pending', 'club', 'Pending Club', 'pending-club');
		insert into group_member (id, group_id, user_id, role, status) values
			('m1', 'g-sus', 'u-plain', 'owner', 'active'),
			('m2', 'g-sus', 'u-sus', 'member', 'active'),
			('m3', 'g-plain', 'u-plain', 'owner', 'active'),
			('m4', 'g-pending', 'u-plain', 'owner', 'active'),
			('m5', 'g-pending', 'u-left', 'member', 'pending');
	`);
});

describe('calendarBlock', () => {
	const facts = { groupHasSustaining: false, creatorIsSustaining: false };

	it('prints CMC listings first whoever made them', () => {
		expect(calendarBlock({ ...facts, source: 'cmc', creatorIsSustaining: true })).toBe('cmc');
	});

	it("reads a band or group listing by its group's members, not its submitter", () => {
		for (const source of ['band', 'group'] as const) {
			expect(calendarBlock({ ...facts, source, groupHasSustaining: true })).toBe('sustaining');
			expect(calendarBlock({ ...facts, source, creatorIsSustaining: true })).toBe('member');
		}
	});

	it('reads a community listing by its submitter', () => {
		expect(calendarBlock({ ...facts, source: 'community', creatorIsSustaining: true })).toBe(
			'sustaining'
		);
		expect(calendarBlock({ ...facts, source: 'community', groupHasSustaining: true })).toBe(
			'member'
		);
	});
});

describe('monthCalendar', () => {
	it('groups the month into CMC, sustaining member and member blocks, each by date', async () => {
		listing('cmc-late', 'cmc', NOV(20));
		listing('cmc-early', 'cmc', NOV(2));
		listing('band-sus', 'band', NOV(10), { groupId: 'g-sus' });
		listing('band-plain', 'band', NOV(5), { groupId: 'g-plain' });
		// The only subscriber in this club has not been accepted yet.
		listing('club-pending', 'group', NOV(6), { groupId: 'g-pending' });
		listing('comm-sus', 'community', NOV(3), { by: 'u-sus' });
		listing('comm-plain', 'community', NOV(4));

		const cal = await monthCalendar('2026-11');
		expect(cal.blocks.map((b) => [b.block, b.events.map((e) => e.id)])).toEqual([
			['cmc', ['cmc-early', 'cmc-late']],
			['sustaining', ['comm-sus', 'band-sus']],
			['member', ['comm-plain', 'band-plain', 'club-pending']]
		]);
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
		expect(cal.blocks.flatMap((b) => b.events.map((e) => e.id))).toEqual(['kept']);
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
