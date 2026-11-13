import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * An organization's people, against a real SQLite (#2622): exact-email
 * auto-merge, the retention horizon on reads, and the sweep. Rows are written
 * and read with raw SQL, so this file never names the guarded table.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite, withBatch } = await import('#lib/server/testing/migrated-sqlite.js');
	const handle = migratedSqlite({ foreignKeys: true });
	return { sqlite: handle.sqlite, testDb: withBatch(handle) };
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
const auth = vi.hoisted(() => ({
	requireCapability: vi.fn(async (_cap: string) => ({ id: 'staff-1' })),
	can: vi.fn(async (_cap: string, _scope?: unknown) => false)
}));
vi.mock('#lib/server/authorization.js', () => auth);

const people = await import('./contact-service');

const sec = (d: Date) => Math.floor(d.getTime() / 1000);
const rows = () =>
	sqlite
		.prepare(`select id, organization_id, name, email, phone from contact order by created_at, id`)
		.all() as { id: string; organization_id: string | null; name: string | null }[];

beforeEach(() => {
	sqlite.exec(`delete from party_role; delete from contact; delete from subscriber;
		delete from organization;
		insert into organization (id, name) values ('org-a', 'Arts Council'), ('org-b', 'Guitar Shop');`);
});

describe('exact-email auto-merge', () => {
	it('attaches a new person to the contact already holding the address', async () => {
		const first = await people.createContact({ name: 'Priya', email: 'Priya@Example.org' });
		const again = await people.createContact({
			organizationId: 'org-a',
			name: 'P. Natarajan',
			email: ' priya@example.org '
		});

		expect(again).toEqual({ id: first.id, merged: true });
		expect(rows()).toEqual([
			expect.objectContaining({ id: first.id, organization_id: 'org-a', name: 'Priya' })
		]);
	});

	it('reuses the contact when an organization form names a known address', async () => {
		const first = await people.createContact({ name: 'Priya', email: 'priya@example.org' });
		await people.setPrimaryContact('org-b', { name: 'Someone', email: 'PRIYA@example.org' });

		expect(rows()).toHaveLength(1);
		expect(rows()[0]).toMatchObject({ id: first.id, organization_id: 'org-b' });
	});

	it('keeps a person at their own organization when another names the same address', async () => {
		await people.createContact({ organizationId: 'org-a', email: 'info@example.org' });
		await people.createContact({ organizationId: 'org-b', email: 'info@example.org' });
		expect(rows().map((r) => r.organization_id)).toEqual(['org-a']);
	});

	it('adds a new person for a new address', async () => {
		await people.createContact({ email: 'a@example.org' });
		await people.createContact({ email: 'b@example.org' });
		expect(rows()).toHaveLength(2);
	});
});

describe('retention', () => {
	it('shows a person until their horizon, and the sweep deletes them after it', async () => {
		const { id } = await people.createContact({ organizationId: 'org-a', name: 'Dana' });
		sqlite.exec(`insert into party_role (id, contact_id, role) values ('r1', '${id}', 'donor')`);

		// A month ahead of the real clock, which `primaryContacts` reads.
		const now = new Date();
		const ahead = new Date(now.getTime() + 30 * 86_400_000);
		sqlite.prepare(`update contact set retain_until = ? where id = ?`).run(sec(ahead), id);
		expect((await people.primaryContacts(['org-a'])).get('org-a')?.name).toBe('Dana');
		expect(await people.sweepExpiredContacts(now)).toEqual({ deleted: 0 });

		const after = new Date(ahead.getTime() + 1000);
		expect(await people.sweepExpiredContacts(after)).toEqual({ deleted: 1 });
		expect(rows()).toEqual([]);
		expect(sqlite.prepare(`select count(*) as n from party_role`).get()).toEqual({ n: 0 });
	});
});
describe('duplicates', () => {
	it('suggests people with the same name or the same phone, and never merges them', async () => {
		await people.createContact({ name: 'Sam Okafor', email: 'sam@a.example' });
		await people.createContact({
			name: '  sam  okafor ',
			email: 'sam@b.example'
		});
		await people.createContact({ name: 'Front desk', phone: '(541) 555-0100' });
		await people.createContact({ name: 'Box office', phone: '1-541-555-0100' });
		await people.createContact({ name: 'Nobody alike', phone: '541-555-0199' });

		const groups = await people.listContactMergeSuggestions();
		expect(groups.map((g) => [g.reason, g.people.length]).sort()).toEqual([
			['name', 2],
			['phone', 2]
		]);
		expect(rows()).toHaveLength(5);
	});

	it('folds one person into another, keeping their roles and details', async () => {
		const keep = await people.createContact({
			organizationId: 'org-a',
			name: 'Sam Okafor'
		});
		const dupe = await people.createContact({
			name: 'Sam O.',
			email: 'sam@b.example',
			phone: '541-555-0188'
		});
		sqlite.exec(
			`insert into party_role (id, contact_id, role) values ('r-d', '${dupe.id}', 'press')`
		);

		expect(await people.mergeContacts(keep.id, dupe.id)).toBe('Sam Okafor');

		expect(rows()).toEqual([
			expect.objectContaining({
				id: keep.id,
				organization_id: 'org-a',
				name: 'Sam Okafor',
				email: 'sam@b.example',
				phone: '541-555-0188'
			})
		]);
		expect(sqlite.prepare(`select contact_id as c, role from party_role`).all()).toEqual([
			{ c: keep.id, role: 'press' }
		]);
		const { notes } = sqlite.prepare(`select notes from contact`).get() as {
			notes: string;
		};
		expect(notes).toContain('Sam O.');
	});
});

describe("an act's people (#2622)", () => {
	const slotPeople = () =>
		sqlite.prepare(`select name, email, phone, source from contact order by created_at, id`).all();

	it('adds the person the act typed at its organization, as self-entered', async () => {
		await people.writeActContactUnguarded('org-a', {
			name: 'Tour Manager',
			email: 'TM@Band.example',
			phone: '541-555-0101'
		});
		expect(rows()).toEqual([
			expect.objectContaining({ organization_id: 'org-a', email: 'tm@band.example' })
		]);
		expect(slotPeople()).toEqual([
			{
				name: 'Tour Manager',
				email: 'tm@band.example',
				phone: '541-555-0101',
				source: 'self_entered'
			}
		]);
	});

	it('updates the person already holding the address, wherever they are', async () => {
		const known = await people.createContact({ organizationId: 'org-b', email: 'tm@band.example' });
		await people.writeActContactUnguarded('org-a', {
			name: 'Tour Manager',
			email: 'tm@band.example'
		});
		expect(rows()).toEqual([
			expect.objectContaining({ id: known.id, organization_id: 'org-b', name: 'Tour Manager' })
		]);
	});

	it('adds nobody new when the act saves its sheet twice without an email', async () => {
		await people.writeActContactUnguarded('org-a', { name: 'Fenwick', phone: '541-555-0102' });
		await people.writeActContactUnguarded('org-a', { name: 'Fenwick', phone: '541-555-0109' });
		expect(rows()).toEqual([expect.objectContaining({ name: 'Fenwick', phone: '541-555-0109' })]);
	});

	// Both reads find no entry before either insert runs (#2695).
	it('adds one person when two saves without an email overlap', async () => {
		await Promise.all([
			people.writeActContactUnguarded('org-a', { name: 'Fenwick' }),
			people.writeActContactUnguarded('org-a', { name: 'Fenwick', phone: '541-555-0109' })
		]);
		expect(rows()).toEqual([expect.objectContaining({ name: 'Fenwick', phone: '541-555-0109' })]);
	});

	it('shows the people to a booker on the show, and asks anyone else for readContact', async () => {
		await people.writeActContactUnguarded('org-a', { email: 'tm@band.example' });
		auth.can.mockImplementation(async (cap) => cap === 'production.book');
		expect(await people.listActContacts(['org-a'], 'proj-1')).toHaveLength(1);
		expect(auth.requireCapability).not.toHaveBeenCalledWith('directory.readContact');

		auth.can.mockImplementation(async () => false);
		await people.listActContacts(['org-a'], 'proj-1');
		expect(auth.requireCapability).toHaveBeenCalledWith('directory.readContact');
	});

	it('gives a claimed act’s people a horizon a year out', async () => {
		await people.writeActContactUnguarded('org-a', { email: 'tm@band.example' });
		const now = new Date('2026-11-13T12:00:00Z');
		await people.archiveActContactsForClaim('org-a', now);
		expect(sqlite.prepare(`select retain_until as r from contact`).get()).toEqual({
			r: sec(new Date('2027-11-13T12:00:00Z'))
		});
	});
});

describe('merging people', () => {
	it("moves a show's contact to the survivor", async () => {
		const keep = await people.createContact({ organizationId: 'org-a', name: 'Sam' });
		const dupe = await people.createContact({ organizationId: 'org-a', name: 'Sam O.' });
		sqlite.exec(`
			insert into project (id, name, kind) values ('pr', 'Show', 'production');
			insert into production (id, project_id) values ('pn', 'pr');
			insert into production_slot (id, production_id, sort_order, set_length_minutes, contact_id)
				values ('slot', 'pn', 1, 30, '${dupe.id}');
		`);
		await people.mergeContacts(keep.id, dupe.id);
		expect(sqlite.prepare(`select contact_id as c from production_slot`).get()).toEqual({
			c: keep.id
		});
		sqlite.exec(`delete from production_slot; delete from production; delete from project`);
	});

	/**
	 * The class: a table that references `contact` and that merging does not
	 * move. Its rows would cascade away or be nulled with the merged person.
	 */
	it('moves every table that references a person', () => {
		const moved = new Set([
			'party_role', // copied, then cascade
			'work_order_link', // copyLinks
			'activity', // moveActivity
			'inbox_thread', // moveThreads
			'production_slot' // the show's contact
		]);
		const tables = (
			sqlite
				.prepare(`select name from sqlite_master where type = 'table' and name not like 'sqlite_%'`)
				.all() as { name: string }[]
		).map((t) => t.name);
		const referencing = tables.filter((t) =>
			(sqlite.prepare(`pragma foreign_key_list("${t}")`).all() as { table: string }[]).some(
				(fk) => fk.table === 'contact'
			)
		);
		expect(referencing.filter((t) => !moved.has(t))).toEqual([]);
	});
});
