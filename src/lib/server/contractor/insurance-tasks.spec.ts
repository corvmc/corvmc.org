import { describe, it, expect, vi, beforeEach } from 'vitest';

/** A lapsing certificate opens one task, closed when a later date is saved (#2757). */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { createContractor, updateContractor, syncInsuranceTasks } =
	await import('./contractor-service');

const DAY = 86_400_000;
const tasks = () =>
	sqlite
		.prepare(
			`select w.title, w.due_at, w.resolved_at, l.organization_id from work_order w
			 left join work_order_link l on l.work_order_id = w.id where w.source = 'insurance'`
		)
		.all() as {
		title: string;
		due_at: number;
		resolved_at: number | null;
		organization_id: string;
	}[];

beforeEach(() => {
	sqlite.exec(`delete from work_order; delete from contractor_detail; delete from party_role;
		delete from organization;`);
});

describe('insurance tasks', () => {
	it('open 30 days out, due on the expiry, linked to the contractor', async () => {
		const expires = new Date(Date.now() + 20 * DAY);
		const c = await createContractor({
			name: 'Amp Works',
			trade: 'general',
			insuranceExpiresAt: expires
		});
		expect(tasks()).toEqual([
			{
				title: 'Get a new insurance certificate from Amp Works',
				due_at: Math.floor(expires.getTime() / 1000),
				resolved_at: null,
				organization_id: c.id
			}
		]);
	});

	it('wait until 30 days out, then the daily sweep opens one', async () => {
		await createContractor({
			name: 'Wire Co',
			trade: 'electrical',
			insuranceExpiresAt: new Date(Date.now() + 40 * DAY)
		});
		expect(tasks()).toEqual([]);
		await syncInsuranceTasks(new Date(Date.now() + 15 * DAY));
		await syncInsuranceTasks(new Date(Date.now() + 15 * DAY));
		expect(tasks()).toHaveLength(1);
	});

	it('close when a later expiry date is saved', async () => {
		const c = await createContractor({
			name: 'Amp Works',
			trade: 'general',
			insuranceExpiresAt: new Date(Date.now() + 5 * DAY)
		});
		await updateContractor(c.id, { insuranceExpiresAt: new Date(Date.now() + 365 * DAY) });
		expect(tasks()[0].resolved_at).not.toBeNull();
	});
});
