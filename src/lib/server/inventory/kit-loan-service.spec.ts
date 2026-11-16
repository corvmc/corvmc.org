import { describe, it, expect, beforeEach, vi } from 'vitest';

/** A location lent as one kit, against a real SQLite (#2725). */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/audit/audit-service.js', () => ({ recordAuditEntry: vi.fn() }));

const { checkoutKit, returnKit, getKitLoan, listKitContents, EmptyKitError } =
	await import('./kit-loan-service');
const { recordAuditEntry } = await import('#lib/server/audit/audit-service.js');

function status(assetId: string) {
	return (
		sqlite.prepare(`select status from inventory_asset where id = ?`).get(assetId) as {
			status: string;
		}
	).status;
}

function held(assetId: string) {
	return (
		sqlite
			.prepare(`select coalesce(sum(quantity), 0) as n from stock_movement where asset_id = ?`)
			.get(assetId) as { n: number }
	).n;
}

const lentAssets = async (kitId: string) =>
	(await getKitLoan(kitId))!.lines.map((l) => l.assetId).sort();

beforeEach(() => {
	vi.mocked(recordAuditEntry).mockClear();
	for (const t of [
		'audit_log',
		'work_request',
		'stock_movement',
		'inventory_loan',
		'inventory_kit_loan',
		'inventory_asset',
		'inventory_item',
		'inventory_location',
		'equipment_category',
		'user'
	]) {
		sqlite.exec(`DELETE FROM ${t}`);
	}
	// case → drawer (nested); shelf is elsewhere.
	sqlite.exec(`
		INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
		VALUES ('m', 'Member', 'm@example.com', 0, 0, 0);
		INSERT INTO equipment_category (id, name, display_order, pricing_tier) VALUES ('cat', 'Gear', 0, 'major');
		INSERT INTO inventory_item (id, name, category_id, kind) VALUES
			('spk', 'Speaker', 'cat', 'serialized'), ('mic', 'Mic', 'cat', 'serialized');
		INSERT INTO inventory_location (id, name, parent_id) VALUES
			('case', 'Offsite kit', NULL), ('drawer', 'Mic drawer', 'case'), ('shelf', 'Shelf', NULL);
		INSERT INTO inventory_asset (id, item_id, condition, status, location_id) VALUES
			('spk-1', 'spk', 'good', 'in_service', 'case'),
			('spk-2', 'spk', 'good', 'in_service', 'case'),
			('mic-1', 'mic', 'good', 'in_service', 'drawer'),
			('mic-2', 'mic', 'good', 'on_loan', 'drawer'),
			('mic-3', 'mic', 'good', 'in_service', 'shelf');
		INSERT INTO stock_movement (id, item_id, asset_id, quantity, reason, occurred_at, created_at) VALUES
			('r1', 'spk', 'spk-1', 1, 'receive', 0, 0), ('r2', 'spk', 'spk-2', 1, 'receive', 0, 0),
			('r3', 'mic', 'mic-1', 1, 'receive', 0, 0), ('r4', 'mic', 'mic-3', 1, 'receive', 0, 0);
	`);
});

const checkout = () => checkoutKit({ locationId: 'case', userId: 'm', dueDate: null });

describe('checkoutKit', () => {
	it('lends every in-service unit in the location and its nested locations', async () => {
		const kit = await checkout();
		expect(await lentAssets(kit.id)).toEqual(['mic-1', 'spk-1', 'spk-2']);
		for (const a of ['spk-1', 'spk-2', 'mic-1']) {
			expect(status(a)).toBe('on_loan');
			expect(held(a)).toBe(0);
		}
		expect(status('mic-3')).toBe('in_service');
	});

	it('leaves a unit already on loan behind and records it', async () => {
		const kit = await checkout();
		expect(kit.leftBehind.map((r) => r.assetId)).toEqual(['mic-2']);
		expect(vi.mocked(recordAuditEntry)).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'kit_loan.checked_out_incomplete' })
		);
	});

	it('refuses a location with nothing to lend', async () => {
		await expect(
			checkoutKit({ locationId: 'drawer', userId: 'm', dueDate: null }).then(() =>
				checkoutKit({ locationId: 'drawer', userId: 'm', dueDate: null })
			)
		).rejects.toBeInstanceOf(EmptyKitError);
	});

	it('keeps what was lent when a unit moves afterwards', async () => {
		const kit = await checkout();
		sqlite.exec(`UPDATE inventory_asset SET location_id = 'shelf' WHERE id = 'spk-1'`);
		sqlite.exec(`UPDATE inventory_asset SET location_id = 'case' WHERE id = 'mic-3'`);
		expect(await lentAssets(kit.id)).toEqual(['mic-1', 'spk-1', 'spk-2']);
		expect((await listKitContents('case')).rows.map((r) => r.assetId)).not.toContain('spk-1');
	});
});

describe('returnKit', () => {
	const loanFor = async (kitId: string, assetId: string) =>
		(await getKitLoan(kitId))!.lines.find((l) => l.assetId === assetId)!.loanId;

	it('lists what did not come back and keeps the kit open', async () => {
		const kit = await checkout();
		const back = [await loanFor(kit.id, 'spk-1'), await loanFor(kit.id, 'mic-1')];
		const result = await returnKit(kit.id, { returnedLoanIds: back });

		expect(result.closed).toBe(false);
		expect(result.missing.map((l) => l.assetId)).toEqual(['spk-2']);
		expect(status('spk-1')).toBe('in_service');
		expect(held('spk-1')).toBe(1);
		expect(status('spk-2')).toBe('on_loan');
		expect((await getKitLoan(kit.id))!.returnedAt).toBeNull();
		expect(vi.mocked(recordAuditEntry)).toHaveBeenCalledWith(
			expect.objectContaining({ action: 'kit_loan.returned_incomplete' })
		);
	});

	it('closes the kit once everything is back', async () => {
		const kit = await checkout();
		await returnKit(kit.id, { returnedLoanIds: [await loanFor(kit.id, 'spk-1')] });
		const rest = (await getKitLoan(kit.id))!.lines.filter((l) => l.out).map((l) => l.loanId);
		const result = await returnKit(kit.id, { returnedLoanIds: rest });

		expect(result.closed).toBe(true);
		expect(result.missing).toEqual([]);
		expect((await getKitLoan(kit.id))!.returnedAt).not.toBeNull();
		for (const a of ['spk-1', 'spk-2', 'mic-1']) expect(held(a)).toBe(1);
	});

	it('sends a unit with an open blocking report to the shop', async () => {
		const kit = await checkout();
		sqlite.exec(
			`INSERT INTO work_request (id, asset_id, note, status, blocks_use) VALUES ('wr', 'spk-1', 'Blown', 'pending', 1)`
		);
		const all = (await getKitLoan(kit.id))!.lines.map((l) => l.loanId);
		await returnKit(kit.id, { returnedLoanIds: all });
		expect(status('spk-1')).toBe('maintenance');
		expect(held('spk-1')).toBe(0);
	});
});
