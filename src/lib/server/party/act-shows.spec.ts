import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * An outside act's shows on its organization page (#2783), against a real
 * SQLite: every bill crediting the act's entry, with the deal and payment from
 * its slot when the show has one.
 */
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const orgs = await import('./organization-service');

const at = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

beforeEach(() => {
	sqlite.exec(`
		delete from production_slot; delete from production; delete from project;
		delete from event_band; delete from event_listing;
		delete from party_role; delete from organization; delete from directory_entry;
		insert into directory_entry (id, name, visibility) values
			('de-harbor', 'Harbor Lights', 'hidden'), ('de-other', 'Other Act', 'hidden');
	`);
	const listing = sqlite.prepare(
		`insert into event_listing (id, title, starts_at, ends_at, kind, source, status, project_id, created_by_user_id)
		 values (?, ?, ?, ?, 'show', 'cmc', 'published', ?, 'u-staff')`
	);
	sqlite.exec(`
		insert into project (id, name, kind) values ('pr', 'Recital', 'production');
		insert into production (id, project_id, status) values ('pn', 'pr', 'confirmed');
	`);
	listing.run(
		'ev-recital',
		'Classical Recital',
		at('2030-06-07T02:00Z'),
		at('2030-06-07T04:00Z'),
		'pr'
	);
	listing.run('ev-open', 'Open Mic', at('2030-07-01T02:00Z'), at('2030-07-01T04:00Z'), null);
	listing.run('ev-elsewhere', 'Other Show', at('2030-07-02T02:00Z'), at('2030-07-02T04:00Z'), null);
	sqlite.exec(`
		insert into event_band (id, event_id, name, directory_entry_id, billing_order, status) values
			('eb-1', 'ev-recital', 'Harbor Lights', 'de-harbor', 0, 'unlinked'),
			('eb-2', 'ev-open', 'Harbor Lights', 'de-harbor', 1, 'unlinked'),
			('eb-3', 'ev-elsewhere', 'Other Act', 'de-other', 0, 'unlinked');
		insert into production_slot (id, production_id, event_band_id, sort_order, set_length_minutes,
			guarantee_cents, paid_cents, paid_at) values
			('slot-1', 'pn', 'eb-1', 1, 45, 20000, 20000, ${at('2030-06-08T00:00Z')});
	`);
});

describe('an outside act’s shows', () => {
	it('lists every show crediting the act, newest first, with its deal and payment', async () => {
		const orgId = await orgs.performerFor('de-harbor');
		const { shows } = await orgs.organizationRecords(orgId);

		expect(shows.map((s) => s.eventId)).toEqual(['ev-open', 'ev-recital']);
		expect(shows[1]).toMatchObject({
			title: 'Classical Recital',
			terms: expect.objectContaining({ guaranteeCents: 20000 }),
			paidCents: 20000
		});
		expect(shows[0]).toMatchObject({ title: 'Open Mic', terms: null, paidCents: null });
	});

	it('lists none for an organization with no act entry', async () => {
		sqlite.exec(`insert into organization (id, name) values ('org-plain', 'Plain Org')`);
		expect((await orgs.organizationRecords('org-plain')).shows).toEqual([]);
	});
});
