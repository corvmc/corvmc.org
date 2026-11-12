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

const count = (table: string) =>
	(sqlite.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;

beforeEach(() => {
	for (const t of [
		'grant_application',
		'sponsorship',
		'contractor_detail',
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
