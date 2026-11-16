import { describe, it, expect, vi, beforeEach } from 'vitest';

/** An unmatched door card payment opens one task (#2757), on Money's position (#2940). */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
const settings: Record<string, string> = {};
vi.mock('#lib/server/site-config/site-config-service.js', () => ({
	config: async (key: string) => settings[key] ?? ''
}));

const { openUnmatchedPaymentTask } = await import('./unmatched-payment-task');

beforeEach(() => {
	sqlite.exec(`delete from work_order; delete from group_position; delete from "group";
		insert into "group" (id, kind, name, slug, join_policy)
			values ('ops', 'committee', 'Operations', 'ops', 'invite_only');
		insert into group_position (id, group_id, name) values ('treasurer', 'ops', 'Treasurer');`);
	delete settings['finance.doorPaymentPositionId'];
});

const open = () =>
	openUnmatchedPaymentTask({ paymentIntentId: 'pi_1', kind: 'sale', amountCents: 1500 });
const routing = () =>
	sqlite
		.prepare(`select position_id, group_id from work_order where source = 'door_payment'`)
		.all();

describe('unmatched door payment tasks', () => {
	// #2940: they opened with no position, waiting unassigned.
	it('wait on the position Money settings name', async () => {
		settings['finance.doorPaymentPositionId'] = 'treasurer';
		await open();
		expect(routing()).toEqual([{ position_id: 'treasurer', group_id: 'ops' }]);
	});

	it('wait unassigned with no position set', async () => {
		await open();
		expect(routing()).toEqual([{ position_id: null, group_id: null }]);
	});
});
