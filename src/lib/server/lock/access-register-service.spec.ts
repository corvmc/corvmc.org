import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

/**
 * The key holder register: who holds standing access to the building, who
 * issued it, and whether it came back. Keys and alarm codes are recorded here;
 * standing lock codes are read from `lock_member_code`, never copied.
 */

let selectResults: unknown[][] = [];
let updateReturning: unknown[] = [];
const inserted: Record<string, unknown>[] = [];
const updated: Record<string, unknown>[] = [];
const whereArgs: unknown[] = [];

function chain(queue: () => unknown[]): unknown {
	const proxy: unknown = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') return (resolve: (v: unknown[]) => void) => resolve(queue());
			if (prop === 'where') {
				return (arg: unknown) => {
					whereArgs.push(arg);
					return proxy;
				};
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chain(() => (selectResults.length > 0 ? selectResults.shift()! : []))),
		insert: vi.fn(() => ({
			values: (v: Record<string, unknown>) => {
				inserted.push(v);
				return { returning: () => Promise.resolve([{ id: 'ah-1', ...v }]) };
			}
		})),
		update: vi.fn(() => ({
			set: (v: Record<string, unknown>) => {
				updated.push(v);
				return chain(() => updateReturning);
			}
		}))
	}
}));

const {
	issueHolding,
	returnHolding,
	listAccessRegister,
	AccessHoldingNotFoundError,
	AccessHoldingReturnedError
} = await import('./access-register-service');

const dialect = new SQLiteSyncDialect();

beforeEach(() => {
	vi.clearAllMocks();
	selectResults = [];
	updateReturning = [];
	inserted.length = 0;
	updated.length = 0;
	whereArgs.length = 0;
});

describe('issueHolding', () => {
	it('records who issued it and takes the holder name from their account', async () => {
		selectResults = [[{ name: 'Ada Lovelace' }]];

		await issueHolding({
			kind: 'key',
			label: 'Front door key 3',
			holderUserId: 'u-1',
			issuedByUserId: 'staff-1'
		});

		expect(inserted[0]).toMatchObject({
			kind: 'key',
			label: 'Front door key 3',
			holderUserId: 'u-1',
			holderName: 'Ada Lovelace',
			issuedByUserId: 'staff-1'
		});
		expect(inserted[0].issuedAt).toBeInstanceOf(Date);
	});

	it('takes a typed name for somebody with no account', async () => {
		await issueHolding({
			kind: 'alarm_code',
			label: 'Alarm user 12',
			holderName: 'Landlord',
			issuedByUserId: 'staff-1'
		});

		expect(inserted[0]).toMatchObject({ holderUserId: null, holderName: 'Landlord' });
	});

	it('refuses a holding with nobody named', async () => {
		await expect(
			issueHolding({ kind: 'key', label: 'Key 1', holderName: '  ', issuedByUserId: 's' })
		).rejects.toThrow();
		expect(inserted).toHaveLength(0);
	});
});

describe('returnHolding', () => {
	it('closes an open holding, recording who took it back', async () => {
		updateReturning = [{ id: 'ah-1' }];

		await returnHolding('ah-1', { returnedByUserId: 'staff-2', notes: 'Left the collective' });

		expect(updated[0]).toMatchObject({
			returnedByUserId: 'staff-2',
			returnNotes: 'Left the collective'
		});
		const { sql } = dialect.sqlToQuery(whereArgs[0] as SQL);
		expect(sql).toContain('"access_holding"."returned_at" is null');
	});

	it('refuses to return something twice', async () => {
		updateReturning = [];
		selectResults = [[{ id: 'ah-1' }]];

		await expect(returnHolding('ah-1', { returnedByUserId: 's' })).rejects.toThrow(
			AccessHoldingReturnedError
		);
	});

	it('says so when the holding does not exist', async () => {
		updateReturning = [];
		selectResults = [[]];

		await expect(returnHolding('nope', { returnedByUserId: 's' })).rejects.toThrow(
			AccessHoldingNotFoundError
		);
	});
});

describe('listAccessRegister', () => {
	const issued = new Date('2026-01-10T12:00:00Z');
	const holding = {
		id: 'ah-1',
		kind: 'key',
		label: 'Front door key 3',
		holderUserId: 'u-1',
		holderName: 'Ada',
		issuedAt: issued,
		notes: null,
		returnedAt: null,
		returnNotes: null,
		issuedByName: 'Sam'
	};
	const lockCode = {
		id: 'lc-1',
		userId: 'u-2',
		label: 'Bo',
		memberName: 'Bo Diddley',
		createdAt: new Date('2026-02-01T12:00:00Z'),
		revokedAt: null,
		revokedReason: null,
		grantedByName: null
	};

	it('lists keys and alarm codes beside standing lock codes', async () => {
		selectResults = [[holding], [lockCode]];

		const rows = await listAccessRegister();

		expect(rows.map((r) => [r.kind, r.label, r.holderName])).toEqual([
			['key', 'Front door key 3', 'Ada'],
			['lock_code', 'Bo', 'Bo Diddley']
		]);
		expect(rows[1]).toMatchObject({ source: 'lock', issuedAt: lockCode.createdAt });
	});

	it('shows only what is still held unless asked for the history', async () => {
		selectResults = [[], []];
		await listAccessRegister();
		expect(dialect.sqlToQuery(whereArgs[0] as SQL).sql).toContain('is null');
		expect(dialect.sqlToQuery(whereArgs[1] as SQL).sql).toContain('is null');

		whereArgs.length = 0;
		selectResults = [[], [{ ...lockCode, revokedAt: issued, revokedReason: 'Lapsed' }]];
		const history = await listAccessRegister({ includeReturned: true });
		expect(whereArgs).toEqual([undefined, undefined]);
		expect(history[0]).toMatchObject({ returnedAt: issued, returnNotes: 'Lapsed' });
	});
});
