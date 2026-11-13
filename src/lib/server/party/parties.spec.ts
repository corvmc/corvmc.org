import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Funders, sponsors and contractors are organizations with a role (#2622).
 * Against a real SQLite: role filters, archiving and the in-use refusals are
 * all predicates a mocked `db` would agree with either way.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite, withBatch } = await import('#lib/server/testing/migrated-sqlite.js');
	const handle = migratedSqlite({ foreignKeys: true });
	return { sqlite: handle.sqlite, testDb: withBatch(handle) };
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const orgs = await import('./organization-service');
const funders = await import('#lib/server/grant/funder-service.js');
const grants = await import('#lib/server/grant/grant-service.js');
const sponsors = await import('#lib/server/sponsor/sponsor-service.js');
const contractors = await import('#lib/server/contractor/contractor-service.js');
const orders = await import('#lib/server/inventory/order-service.js');

const count = (table: string) =>
	(sqlite.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;

beforeEach(() => {
	for (const t of [
		'purchase_order',
		'grant_application',
		'sponsorship',
		'contractor_detail',
		'vendor_detail',
		'party_role',
		'organization'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
});

describe('roles', () => {
	it('lists only the organizations holding the role, archived ones on request', async () => {
		const shop = await funders.createFunder({ name: 'Arts Council' });
		await sponsors.createSponsor({ name: 'Guitar Shop' });
		const old = await funders.createFunder({ name: 'Old Trust' });
		await funders.archiveFunder(old.id);

		expect((await funders.listFunders()).map((f) => f.id)).toEqual([shop.id]);
		expect((await funders.listFunders({ includeArchived: true })).map((f) => f.name)).toEqual([
			'Arts Council',
			'Old Trust'
		]);
		await funders.restoreFunder(old.id);
		expect(await funders.listFunders()).toHaveLength(2);
	});

	it('lets one organization hold several roles', async () => {
		const shop = await sponsors.createSponsor({ name: 'Guitar Shop' });
		await orgs.addRole(shop.id, 'supplier');
		await orgs.addRole(shop.id, 'supplier');
		expect((await orgs.getOrganization(shop.id)).roles.sort()).toEqual(['sponsor', 'supplier']);
	});

	it('refuses a grant application naming an organization that is not a funder', async () => {
		const shop = await sponsors.createSponsor({ name: 'Guitar Shop' });
		await expect(
			grants.createGrant({ organizationId: shop.id, title: 'Ops', status: 'prospect' })
		).rejects.toBeInstanceOf(orgs.OrganizationLacksRoleError);
		expect(count('grant_application')).toBe(0);
	});

	it('refuses a sponsorship naming an organization that is not a sponsor', async () => {
		const council = await funders.createFunder({ name: 'Arts Council' });
		await expect(
			sponsors.createSponsorship({ organizationId: council.id, title: 'Season', status: 'active' })
		).rejects.toBeInstanceOf(orgs.OrganizationLacksRoleError);
	});

	it('treats an organization without the role as not found on that role’s page', async () => {
		const council = await funders.createFunder({ name: 'Arts Council' });
		await expect(sponsors.getSponsor(council.id, '2026-11-12')).rejects.toBeInstanceOf(
			sponsors.SponsorNotFoundError
		);
		await expect(contractors.getContractorById(council.id)).rejects.toBeInstanceOf(
			contractors.ContractorNotFoundError
		);
	});
});

describe('performers', () => {
	it('makes one performer organization per act listing, named for it, and reuses it', async () => {
		sqlite.exec(
			`insert into directory_entry (id, name, visibility) values ('de-p', 'Sawtooth Rivals', 'hidden')`
		);
		const first = await orgs.performerFor('de-p');
		expect(await orgs.performerFor('de-p')).toBe(first);
		expect(await orgs.getOrganization(first)).toMatchObject({
			name: 'Sawtooth Rivals',
			directoryEntryId: 'de-p',
			roles: ['performer']
		});
		sqlite.exec(`delete from organization; delete from directory_entry where id = 'de-p'`);
	});

	it('counts the band an act became, and moves it on merge', async () => {
		const act = await orgs.createOrganization({ name: 'Fenwick' }, ['performer']);
		const dupe = await orgs.createOrganization({ name: 'Fenwick (solo)' }, ['performer']);
		sqlite.exec(
			`insert into "group" (id, kind, name, slug, from_organization_id) values ('g-f', 'band', 'Fenwick', 'fenwick', '${dupe.id}')`
		);
		expect(await orgs.countRecords(dupe.id)).toBe(1);
		await orgs.mergeOrganizations(act.id, dupe.id);
		expect(
			sqlite.prepare(`select from_organization_id as o from "group" where id = 'g-f'`).get()
		).toEqual({ o: act.id });
		sqlite.exec(`delete from "group" where id = 'g-f'`);
	});
});

describe('suppliers', () => {
	it('reuses an organization named the same, ignoring case and spaces, and gives it the role', async () => {
		const shop = await sponsors.createSponsor({ name: 'Guitar Shop' });
		expect(await orgs.organizationNamed('  guitar SHOP ', 'supplier')).toBe(shop.id);
		expect((await orgs.getOrganization(shop.id)).roles.sort()).toEqual(['sponsor', 'supplier']);
		expect(count('organization')).toBe(1);
	});

	it('creates a supplier when no organization has the name', async () => {
		const id = await orgs.organizationNamed('Sweetwater', 'supplier');
		expect((await orgs.getOrganization(id)).roles).toEqual(['supplier']);
		expect(await orders.listSupplierNames()).toEqual(['Sweetwater']);
	});

	it('refuses a purchase order naming an organization that is not a supplier', async () => {
		const council = await funders.createFunder({ name: 'Arts Council' });
		await expect(
			orders.createOrder({
				organizationId: council.id,
				lines: [{ itemId: 'item', quantityOrdered: 1 }]
			})
		).rejects.toBeInstanceOf(orgs.OrganizationLacksRoleError);
		expect(count('purchase_order')).toBe(0);
	});

	it('refuses to remove the role while an order names it', async () => {
		const shop = await orgs.createOrganization({ name: 'Sweetwater' }, ['supplier']);
		sqlite.exec(
			`insert into purchase_order (id, status, organization_id) values ('po-r', 'draft', '${shop.id}')`
		);
		expect(await orgs.countRecords(shop.id)).toBe(1);
	});
});

describe('deleting a role', () => {
	it('refuses while a record names the organization in it', async () => {
		const council = await funders.createFunder({ name: 'Arts Council' });
		await grants.createGrant({ organizationId: council.id, title: 'Ops', status: 'prospect' });
		await expect(funders.deleteFunder(council.id)).rejects.toBeInstanceOf(
			orgs.OrganizationInUseError
		);
		expect(count('organization')).toBe(1);
	});

	it('deletes an organization left with no role and no records', async () => {
		const shop = await sponsors.createSponsor({ name: 'Typo Shop' });
		await sponsors.deleteSponsor(shop.id);
		expect(count('organization')).toBe(0);
	});

	it('keeps an organization that still holds another role', async () => {
		const shop = await sponsors.createSponsor({ name: 'Guitar Shop' });
		await orgs.addRole(shop.id, 'supplier');
		await sponsors.deleteSponsor(shop.id);
		expect((await orgs.getOrganization(shop.id)).roles).toEqual(['supplier']);
	});
});

describe('contractors', () => {
	it('stores the trade beside the organization and archives without deleting', async () => {
		const c = await contractors.createContractor({
			name: 'Amp Works',
			trade: 'instrument_repair',
			licenseNumber: 'L-1'
		});
		expect(c).toMatchObject({
			name: 'Amp Works',
			trade: 'instrument_repair',
			licenseNumber: 'L-1'
		});

		await contractors.archiveContractor(c.id);
		expect(await contractors.listContractors()).toEqual([]);
		expect((await contractors.getContractorById(c.id)).archivedAt).toBeInstanceOf(Date);

		await contractors.archiveContractor(c.id, false);
		expect((await contractors.listContractors()).map((r) => r.id)).toEqual([c.id]);
	});

	it('turns an existing organization into a contractor rather than entering it twice', async () => {
		const shop = await sponsors.createSponsor({ name: 'Guitar Shop' });
		await contractors.createContractor({ name: 'Guitar Shop', trade: 'general' }, shop.id);
		expect(count('organization')).toBe(1);
		expect((await orgs.getOrganization(shop.id)).roles.sort()).toEqual(['contractor', 'sponsor']);
	});
});
describe('merging organizations', () => {
	it('moves roles, records and contractor detail to the survivor, then deletes the other', async () => {
		const keep = await sponsors.createSponsor({
			name: 'Guitar Shop',
			notes: 'Main store'
		});
		const dupe = await contractors.createContractor({
			name: 'Guitar Shop Repairs',
			trade: 'instrument_repair',
			notes: 'Back room'
		});
		await funders.createFunder({ name: 'Unrelated' });
		sqlite.exec(`insert into work_order (id, title) values ('wo-m', 'Retube')`);
		sqlite.exec(
			`insert into contractor_job (id, organization_id, work_order_id, status) values ('job-m', '${dupe.id}', 'wo-m', 'asked')`
		);

		const names = await orgs.mergeOrganizations(keep.id, dupe.id);

		expect(names).toEqual({
			survivor: 'Guitar Shop',
			other: 'Guitar Shop Repairs'
		});
		const merged = await orgs.getOrganization(keep.id);
		expect(merged.roles.sort()).toEqual(['contractor', 'sponsor']);
		expect(merged.notes).toContain('Back room');
		expect((await contractors.getContractorById(keep.id)).trade).toBe('instrument_repair');
		expect(
			sqlite.prepare(`select organization_id as o from contractor_job where id = 'job-m'`).get()
		).toEqual({ o: keep.id });
		await expect(orgs.getOrganization(dupe.id)).rejects.toBeInstanceOf(
			orgs.OrganizationNotFoundError
		);
		sqlite.exec(`delete from contractor_job; delete from work_order`);
	});

	it('moves purchase orders to the survivor', async () => {
		const keep = await orgs.createOrganization({ name: 'Sweetwater' }, ['supplier']);
		const dupe = await orgs.createOrganization({ name: 'Sweetwater Sound' }, ['supplier']);
		sqlite.exec(
			`insert into purchase_order (id, status, organization_id) values ('po-m', 'placed', '${dupe.id}')`
		);
		await orgs.mergeOrganizations(keep.id, dupe.id);
		expect(
			sqlite.prepare(`select organization_id as o from purchase_order where id = 'po-m'`).get()
		).toEqual({ o: keep.id });
	});

	it('moves vendor setup only when the survivor has none', async () => {
		const keep = await orgs.createOrganization({ name: 'Rosa Ceramics' }, ['vendor']);
		const dupe = await orgs.createOrganization({ name: 'Rosa Pottery' }, ['vendor']);
		await orgs.saveVendorDetail(dupe.id, {
			offering: 'Mugs',
			tablesNeeded: 2,
			needsPower: true,
			bringsOwnTable: false,
			bringsTent: true,
			setupNotes: null
		});
		await orgs.mergeOrganizations(keep.id, dupe.id);
		expect((await orgs.getVendorDetail(keep.id))?.tablesNeeded).toBe(2);
	});

	it('refuses vendor setup on an organization that is not a vendor', async () => {
		const shop = await sponsors.createSponsor({ name: 'Guitar Shop' });
		await expect(
			orgs.saveVendorDetail(shop.id, {
				offering: null,
				tablesNeeded: 1,
				needsPower: false,
				bringsOwnTable: false,
				bringsTent: false,
				setupNotes: null
			})
		).rejects.toBeInstanceOf(orgs.OrganizationLacksRoleError);
	});

	/**
	 * The class: a table that references `organization` and that merging does
	 * not move. Its rows would be orphaned by the delete, or cascade away with
	 * the merged organization. Each table here is moved by name below, or is in
	 * `ORGANIZATION_RECORDS`.
	 */
	it('moves every table that references an organization', () => {
		const movedElsewhere = new Set([
			'party_role', // roles are copied, then cascade
			'contractor_detail', // moved when the survivor has none
			'vendor_detail', // moved when the survivor has none
			'contact', // people move first, through contact-service.ts
			'work_order_link', // copyLinks
			'activity', // moveActivity
			'inbox_thread', // moveThreads
			'group' // the band an act became, by name in mergeOrganizations
		]);
		const tables = (
			sqlite
				.prepare(`select name from sqlite_master where type = 'table' and name not like 'sqlite_%'`)
				.all() as { name: string }[]
		).map((t) => t.name);
		const referencing = tables.filter((t) =>
			(sqlite.prepare(`pragma foreign_key_list("${t}")`).all() as { table: string }[]).some(
				(fk) => fk.table === 'organization'
			)
		);
		const unmoved = referencing.filter(
			(t) => !movedElsewhere.has(t) && !orgs.organizationRecordTables.includes(t)
		);
		expect(unmoved).toEqual([]);
	});

	it('suggests organizations that share a website domain', async () => {
		await sponsors.createSponsor({
			name: 'Block 15',
			website: 'https://www.block15.example/'
		});
		await funders.createFunder({
			name: 'Block 15 Brewing',
			website: 'block15.example'
		});
		await funders.createFunder({
			name: 'Other',
			website: 'https://other.example'
		});

		const groups = await orgs.listOrganizationMergeSuggestions();
		expect(groups.map((g) => g.domain)).toEqual(['block15.example']);
		expect(groups[0].organizations.map((o) => o.name).sort()).toEqual([
			'Block 15',
			'Block 15 Brewing'
		]);
	});

	it('refuses to merge an organization into itself', async () => {
		const shop = await sponsors.createSponsor({ name: 'Guitar Shop' });
		await expect(orgs.mergeOrganizations(shop.id, shop.id)).rejects.toBeInstanceOf(
			orgs.OrganizationMergeError
		);
	});
});
