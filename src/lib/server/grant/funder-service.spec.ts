import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

// A chainable proxy that records calls and resolves to `result`, so the
// assertions are about the query built rather than what a stub returns.
let result: unknown[] = [];
let calls: { method: string; args: unknown[] }[] = [];

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') return (resolve: (v: unknown[]) => void) => resolve(result);
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
		select: vi.fn(() => chainable()),
		update: vi.fn(() => chainable()),
		delete: vi.fn(() => chainable())
	}
}));

const { listFunders, archiveFunder, restoreFunder, FunderNotFoundError } =
	await import('./funder-service');

function renderedWheres() {
	const dialect = new SQLiteSyncDialect();
	return calls
		.filter((c) => c.method === 'where' && c.args[0])
		.map((c) => dialect.sqlToQuery(c.args[0] as SQL).sql);
}

function setColumns() {
	return calls.find((c) => c.method === 'set')?.args[0] as Record<string, unknown>;
}

beforeEach(() => {
	result = [];
	calls = [];
});

describe('listFunders', () => {
	it('leaves archived funders out of the active list', async () => {
		await listFunders();
		expect(renderedWheres()).toContainEqual(expect.stringContaining('"deleted_at" is null'));
	});

	it('includes them when the archived filter is on', async () => {
		await listFunders({ includeArchived: true });
		expect(renderedWheres().some((w) => w.includes('deleted_at'))).toBe(false);
	});
});

describe('archiveFunder and restoreFunder', () => {
	it('stamps deleted_at rather than deleting, so the applications stay', async () => {
		result = [{ id: 'f1' }];
		await archiveFunder('f1');
		expect(setColumns().deletedAt).toBeInstanceOf(Date);
		expect(calls.some((c) => c.method === 'delete')).toBe(false);
	});

	it('clears deleted_at on restore', async () => {
		result = [{ id: 'f1' }];
		await restoreFunder('f1');
		expect(setColumns().deletedAt).toBeNull();
	});

	it('throws not-found for an unknown id', async () => {
		await expect(archiveFunder('nope')).rejects.toBeInstanceOf(FunderNotFoundError);
		await expect(restoreFunder('nope')).rejects.toBeInstanceOf(FunderNotFoundError);
	});
});
