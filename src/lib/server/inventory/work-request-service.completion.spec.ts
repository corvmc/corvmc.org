import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

/**
 * A scheduled work order finishing by the clock closes its reports only when
 * staff flagged it "close reports on completion" (#1544). Unflagged, it waits
 * on the coordinator's Today worklist as "finished: confirm fixed?".
 */

let selectQueue: unknown[][] = [];
let updateReturning: unknown[] = [];
let calls: { method: string; args: unknown[] }[] = [];
const updateValues: Record<string, unknown>[] = [];

function chain(queue: () => unknown[]): unknown {
	const proxy: unknown = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') return (resolve: (v: unknown[]) => void) => resolve(queue());
			return (...args: unknown[]) => {
				calls.push({ method: String(prop), args });
				return proxy;
			};
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chain(() => selectQueue.shift() ?? [])),
		update: vi.fn(() => ({
			set: (values: Record<string, unknown>) => {
				updateValues.push(values);
				return chain(() => updateReturning);
			}
		}))
	}
}));

vi.mock('./asset-service', () => ({
	setAssetStatus: vi.fn(),
	AssetNotFoundError: class extends Error {}
}));

vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: { emit: vi.fn().mockResolvedValue(undefined) }
}));

const { resolveFlagsOnCompletion, listFinishedWorkToConfirm } =
	await import('./work-request-service');

beforeEach(() => {
	selectQueue = [];
	updateReturning = [];
	calls = [];
	updateValues.length = 0;
});

describe('resolveFlagsOnCompletion', () => {
	it('leaves the reports open when the work order is not flagged', async () => {
		selectQueue = [[{ closeReportsOnCompletion: false }]];

		const reporters = await resolveFlagsOnCompletion('wo-1', 'vol-1', 'done');

		expect(reporters).toEqual([]);
		expect(updateValues).toHaveLength(0);
	});

	it('leaves them open for an unknown work order', async () => {
		await resolveFlagsOnCompletion('nope', 'vol-1', 'done');
		expect(updateValues).toHaveLength(0);
	});

	it('closes them, credited to the volunteer, when staff flagged it', async () => {
		selectQueue = [[{ closeReportsOnCompletion: true }]];

		await resolveFlagsOnCompletion('wo-1', 'vol-1', 'done');

		expect(updateValues).toHaveLength(1);
		expect(updateValues[0]).toMatchObject({
			status: 'resolved',
			resolvedByUserId: 'vol-1',
			resolutionNotes: 'done'
		});
	});
});

describe('listFinishedWorkToConfirm', () => {
	it('asks for unflagged, open work orders whose window has passed with reports still pending', async () => {
		await listFinishedWorkToConfirm(new Date('2026-09-24T12:00:00Z'));

		const where = calls.find((c) => c.method === 'where');
		expect(where).toBeDefined();
		const sql = new SQLiteSyncDialect().sqlToQuery(where!.args[0] as SQL).sql;
		expect(sql).toContain('"close_reports_on_completion" = ?');
		expect(sql).toContain('"resolved_at" is null');
		expect(sql).toContain('"cancelled_at" is null');
		expect(sql).toContain('"ends_at" < ?');
		expect(sql).toContain('"status" = ?');
	});
});
