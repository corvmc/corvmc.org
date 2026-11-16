import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The report ledger window against a real SQLite: a "to" day keeps its last
 * minute and stops at the next midnight club time (#3067).
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});
vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { recordEntries, totalsByKindAndCategory } =
	await import('#lib/server/finance/financial-entry-service.js');
const { ledgerWindow } = await import('./money');

const sale = (id: string, occurredAt: Date, amountCents: number) => ({
	amountCents,
	kind: 'earned' as const,
	category: 'ticket_sales' as const,
	occurredAt,
	settlement: 'stripe' as const,
	subjectType: 'ticket' as const,
	subjectId: id,
	description: 'Ticket'
});

beforeEach(() => sqlite.exec('delete from financial_entry'));

describe('ledgerWindow', () => {
	it('counts a sale at 23:59:30 on the "to" day and none at the next midnight', async () => {
		await recordEntries([
			sale('first-minute', new Date('2026-07-01T07:00:00Z'), 1), // 00:00 PDT Jul 1
			sale('last-minute', new Date('2026-08-01T06:59:30Z'), 10), // 23:59:30 PDT Jul 31
			sale('next-midnight', new Date('2026-08-01T07:00:00Z'), 100) // 00:00 PDT Aug 1
		]);

		const rows = await totalsByKindAndCategory(
			ledgerWindow({ from: '2026-07-01', to: '2026-07-31' })
		);

		expect(rows).toEqual([{ kind: 'earned', category: 'ticket_sales', totalCents: 11 }]);
	});
});
