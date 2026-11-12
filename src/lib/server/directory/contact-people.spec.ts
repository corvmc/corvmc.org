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
vi.mock('#lib/server/authorization.js', () => ({
	requireCapability: vi.fn(async () => ({ id: 'staff-1' }))
}));

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
