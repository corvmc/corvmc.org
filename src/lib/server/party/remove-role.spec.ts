import { describe, it, expect, vi } from 'vitest';
import { partyRoles } from '#lib/config.js';

/**
 * The class: a role edit with a cascading side effect (#2784). Removing a role
 * removes that one `party_role` row. The organization, its people, threads,
 * records and act listing all stay, even once it holds no role at all. Walks
 * every role and every table that references `organization`.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite({ foreignKeys: true });
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const orgs = await import('./organization-service');
const createSponsor = (name: string) => orgs.createOrganization({ name }, ['sponsor']);
/** What Contacts' remove-role then Delete does for a sponsor no sponsorship names. */
const deleteSponsor = async (id: string) => {
	await orgs.removeRole(id, 'sponsor', 0);
	await orgs.deleteUnusedOrganization(id);
};

const referencing = (
	sqlite
		.prepare(`select name from sqlite_master where type = 'table' and name not like 'sqlite_%'`)
		.all() as { name: string }[]
)
	.map((t) => t.name)
	.filter((t) =>
		(sqlite.prepare(`pragma foreign_key_list("${t}")`).all() as { table: string }[]).some(
			(fk) => fk.table === 'organization'
		)
	);

/** Rows naming the organization in every referencing table but `party_role`. */
function links(id: string): Record<string, number> {
	return Object.fromEntries(
		referencing
			.filter((t) => t !== 'party_role')
			.map((t) => {
				const cols = (
					sqlite.prepare(`pragma foreign_key_list("${t}")`).all() as {
						table: string;
						from: string;
					}[]
				).filter((fk) => fk.table === 'organization');
				const where = cols.map((c) => `"${c.from}" = ?`).join(' or ');
				const { n } = sqlite
					.prepare(`select count(*) as n from "${t}" where ${where}`)
					.get(...cols.map(() => id)) as { n: number };
				return [t, n];
			})
	);
}

describe('removing a role', () => {
	sqlite.exec(`
		insert into user (id, name, email, email_verified, created_at, updated_at)
			values ('u-1', 'Staff', 'staff@example.com', 0, 0, 0);
		insert into project (id, name, kind) values ('pr-g', 'Spring grant', 'grant');
		insert into work_order (id, title) values ('wo-1', 'Call back');
	`);

	/** People, a thread, notes, a task and an act listing with a show; `records` adds an application. */
	function seed(id: string, records: boolean) {
		sqlite.exec(`
			insert into directory_entry (id, name, visibility) values ('de-${id}', '${id}', 'hidden');
			insert into organization (id, name, directory_entry_id) values ('${id}', '${id}', 'de-${id}');
			insert into contact (id, organization_id, name, email, source)
				values ('c-${id}', '${id}', 'Dana Reyes', '${id}@example.test', 'staff_entered');
			insert into inbox_thread (id, channel, status, subject, preview, contact_email, last_message_at, organization_id)
				values ('t-${id}', 'email', 'open', 'Booking', 'Hi', '${id}@example.test', 1750000000, '${id}');
			insert into activity (id, organization_id, kind, occurred_on, body)
				values ('a-${id}', '${id}', 'call', '2026-11-01', 'Rang');
			insert into work_order_link (id, work_order_id, organization_id) values ('wl-${id}', 'wo-1', '${id}');
			insert into event_listing (id, title, starts_at, ends_at, status, source, kind, created_by_user_id)
				values ('ev-${id}', 'Show', 0, 1, 'draft', 'cmc', 'show', 'u-1');
			insert into event_band (id, event_id, name, billing_order, directory_entry_id, status)
				values ('eb-${id}', 'ev-${id}', '${id}', 1, 'de-${id}', 'confirmed');
		`);
		if (records)
			sqlite.exec(`insert into grant_application (id, title, organization_id, project_id, status)
				values ('ga-${id}', 'Spring grant', '${id}', 'pr-g', 'prospect')`);
	}

	it.each([
		['org-act', false],
		['org-press', true]
	])('keeps %s and everything naming it, down to the last role', async (id, records) => {
		seed(id, records);
		for (const role of partyRoles) await orgs.addRole(id, role);
		const before = links(id);
		expect(before.contact).toBe(1);

		for (const role of partyRoles) {
			await orgs.removeRole(id, role, 0);
			expect(links(id), `after removing ${role}`).toEqual(before);
		}

		expect(await orgs.getOrganization(id)).toMatchObject({
			directoryEntryId: `de-${id}`,
			roles: []
		});
		expect(
			sqlite.prepare(`select count(*) as n from event_band where id = ?`).get(`eb-${id}`)
		).toEqual({ n: 1 });
	});
});

describe('deleting a sponsor', () => {
	it('keeps an organization that people still belong to', async () => {
		const shop = await createSponsor('Guitar Shop');
		sqlite.exec(
			`insert into contact (id, organization_id, name, source) values ('c-shop', '${shop.id}', 'Owner', 'staff_entered')`
		);
		await deleteSponsor(shop.id);
		expect(await orgs.getOrganization(shop.id)).toMatchObject({ roles: [] });
		expect(links(shop.id).contact).toBe(1);
	});

	it('deletes an organization nothing else names', async () => {
		const shop = await createSponsor('Typo Shop');
		await deleteSponsor(shop.id);
		await expect(orgs.getOrganization(shop.id)).rejects.toBeInstanceOf(
			orgs.OrganizationNotFoundError
		);
	});

	/**
	 * The explicit delete checks `ORGANIZATION_RECORDS` and `ORGANIZATION_LINKS`.
	 * A new table referencing `organization` goes in one of them, or here with
	 * the reason it can go with the organization.
	 */
	it('checks every table that references an organization', () => {
		const ownedByIt = new Set(['party_role', 'contractor_detail', 'vendor_detail']);
		const checked = new Set([
			...orgs.organizationRecordTables,
			...orgs.organizationLinkTables,
			'group'
		]);
		expect(referencing.filter((t) => !ownedByIt.has(t) && !checked.has(t))).toEqual([]);
	});
});
