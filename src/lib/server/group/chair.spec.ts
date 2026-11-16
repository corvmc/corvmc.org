import { describe, it, expect, vi, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';

/**
 * Who leads a group (#3009), against a real SQLite: a committee's chair is
 * whoever holds its chair position, never its stored role; a club keeps
 * `admin` and a band keeps `owner`.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite({ foreignKeys: true });
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { groupMember } = await import('#lib/server/db/schema/group.js');
const { isCommitteeChair, leadsGroup, rosterRole, setChairHolder, ensureChairPosition } =
	await import('./chair');
const { getUserRole, updateMember } = await import('#lib/server/band/band-service.js');

beforeEach(() => {
	sqlite.exec(`
		delete from group_position_holder; delete from group_position;
		delete from group_member; delete from "group"; delete from "user";
		insert into "user" (id, name, email) values
			('chair', 'Chair', 'c@example.com'), ('seat', 'Seat', 's@example.com'),
			('stale', 'Stale', 'x@example.com'), ('lead', 'Lead', 'l@example.com');
		insert into "group" (id, kind, name, slug) values
			('com', 'committee', 'Booking', 'booking'),
			('club', 'club', 'Choir', 'choir'),
			('band', 'band', 'Plumfoot', 'plumfoot');
		insert into group_position (id, group_id, name, is_chair) values
			('p-chair', 'com', 'Chair', 1), ('p-sec', 'com', 'Secretary', 0);
		insert into group_member (id, group_id, user_id, role, status) values
			('m-chair', 'com', 'chair', 'member', 'active'),
			('m-seat', 'com', 'seat', 'member', 'active'),
			('m-stale', 'com', 'stale', 'admin', 'active'),
			('m-club', 'club', 'lead', 'admin', 'active'),
			('m-band', 'band', 'lead', 'owner', 'active');
		insert into group_position_holder (position_id, member_id) values
			('p-chair', 'm-chair'), ('p-sec', 'm-seat');
	`);
});

describe('isCommitteeChair', () => {
	it('is the chair position holder, not another position or a stored admin', async () => {
		expect(await isCommitteeChair('chair', 'com')).toBe(true);
		expect(await isCommitteeChair('seat', 'com')).toBe(false);
		expect(await isCommitteeChair('stale', 'com')).toBe(false);
	});

	it('is false for a club admin or band owner', async () => {
		expect(await isCommitteeChair('lead', 'club')).toBe(false);
		expect(await isCommitteeChair('lead', 'band')).toBe(false);
	});

	it('is false once the holder is no longer active', async () => {
		sqlite.exec(`update group_member set status = 'inactive' where id = 'm-chair'`);
		expect(await isCommitteeChair('chair', 'com')).toBe(false);
	});
});

describe('leadsGroup and rosterRole', () => {
	it('picks the committee chair, the club admin and the band owner', async () => {
		const rows = await testDb
			.select({ id: groupMember.id })
			.from(groupMember)
			.where(and(eq(groupMember.status, 'active'), leadsGroup()))
			.orderBy(groupMember.id);
		expect(rows.map((r) => r.id)).toEqual(['m-band', 'm-chair', 'm-club']);
	});

	it('reports the chair as admin and every other committee row as member', async () => {
		const rows = await testDb
			.select({ id: groupMember.id, role: rosterRole() })
			.from(groupMember)
			.orderBy(groupMember.id);
		expect(Object.fromEntries(rows.map((r) => [r.id, r.role]))).toEqual({
			'm-band': 'owner',
			'm-chair': 'admin',
			'm-club': 'admin',
			'm-seat': 'member',
			'm-stale': 'member'
		});
	});
});

describe('setChairHolder', () => {
	it('fills and vacates the chair position', async () => {
		await setChairHolder('com', 'm-seat', true, 'chair');
		expect(await isCommitteeChair('seat', 'com')).toBe(true);
		await setChairHolder('com', 'm-chair', false, 'chair');
		expect(await isCommitteeChair('chair', 'com')).toBe(false);
	});

	it('makes the chair position for a committee that has none', async () => {
		sqlite.exec(`insert into "group" (id, kind, name, slug) values ('new', 'committee', 'New', 'new');
			insert into group_member (id, group_id, user_id, role, status)
			values ('m-new', 'new', 'seat', 'member', 'active')`);
		await setChairHolder('new', 'm-new', true, null);
		expect(await isCommitteeChair('seat', 'new')).toBe(true);
	});

	it('marks a position already called Chair rather than adding a second', async () => {
		sqlite.exec(`insert into "group" (id, kind, name, slug) values ('old', 'committee', 'Old', 'old');
			insert into group_position (id, group_id, name) values ('p-old', 'old', 'Chair')`);
		expect(await ensureChairPosition('old')).toBe('p-old');
	});
});

describe('the guard tier', () => {
	it('gives a committee chair the admin tier and a stored committee admin none', async () => {
		expect(await getUserRole('com', 'chair')).toBe('admin');
		expect(await getUserRole('com', 'stale')).toBe('member');
		expect(await getUserRole('club', 'lead')).toBe('admin');
		expect(await getUserRole('band', 'lead')).toBe('owner');
	});

	it('turns a roster role edit on a committee into the chair position', async () => {
		await updateMember('m-seat', { role: 'admin' }, 'com');
		expect(await isCommitteeChair('seat', 'com')).toBe(true);
		const [row] = sqlite.prepare(`select role from group_member where id = 'm-seat'`).all();
		expect(row).toEqual({ role: 'member' });
	});
});
