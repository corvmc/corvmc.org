import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

/**
 * Retention (#1376): audit rows older than 24 months are deleted in batches,
 * except `user.purged`, which is kept with its name and email stripped.
 */

let deleteResults: unknown[][] = [];
let updateResults: unknown[][] = [];
let updateValues: Record<string, unknown>[] = [];
let deleteWheres: unknown[] = [];
let updateWheres: unknown[] = [];

function chain(queue: () => unknown[], wheres: unknown[]): unknown {
	const proxy: unknown = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') return (resolve: (v: unknown[]) => void) => resolve(queue());
			if (prop === 'where') {
				return (arg: unknown) => {
					wheres.push(arg);
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
		delete: vi.fn(() => chain(() => deleteResults.shift() ?? [], deleteWheres)),
		update: vi.fn(() => ({
			set: (v: Record<string, unknown>) => {
				updateValues.push(v);
				return chain(() => updateResults.shift() ?? [], updateWheres);
			}
		}))
	}
}));

const { sweepAuditLog, auditRetentionCutoff, AUDIT_RETENTION_MONTHS, AUDIT_DELETE_BATCH } =
	await import('./audit-retention');

const dialect = new SQLiteSyncDialect();
const render = (arg: unknown) => dialect.sqlToQuery(arg as SQL);
const now = new Date('2026-09-24T12:00:00Z');
const cutoffSeconds = Math.floor(new Date('2024-09-24T12:00:00Z').getTime() / 1000);
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `a-${i}` }));

beforeEach(() => {
	deleteResults = [];
	updateResults = [];
	updateValues = [];
	deleteWheres = [];
	updateWheres = [];
});

describe('auditRetentionCutoff', () => {
	it('is 24 months before now', () => {
		expect(AUDIT_RETENTION_MONTHS).toBe(24);
		expect(auditRetentionCutoff(now).toISOString()).toBe('2024-09-24T12:00:00.000Z');
	});
});

describe('sweepAuditLog', () => {
	it('deletes rows older than the cutoff, never user.purged, a bounded batch at a time', async () => {
		deleteResults = [[]];

		await sweepAuditLog(now);

		const { sql, params } = render(deleteWheres[0]);
		expect(sql).toMatch(/"audit_log"\."id" in \(select "(audit_log"\.")?id" from "audit_log"/i);
		expect(sql).toContain('"audit_log"."action" <> ?');
		expect(sql).toContain('"audit_log"."created_at" < ?');
		expect(sql).toMatch(/limit \?/i);
		expect(params).toContain('user.purged');
		expect(params).toContain(cutoffSeconds);
		expect(params).toContain(AUDIT_DELETE_BATCH);
	});

	it('keeps deleting while batches come back full, and stops on a short one', async () => {
		deleteResults = [rows(AUDIT_DELETE_BATCH), rows(AUDIT_DELETE_BATCH), rows(3)];

		const result = await sweepAuditLog(now);

		expect(deleteWheres).toHaveLength(3);
		expect(result.deleted).toBe(AUDIT_DELETE_BATCH * 2 + 3);
	});

	it('strips name and email from user.purged rows past the cutoff, keeping the row', async () => {
		deleteResults = [[]];
		updateResults = [[{ id: 'p-1' }, { id: 'p-2' }]];

		const result = await sweepAuditLog(now);

		expect(result.redacted).toBe(2);
		expect(updateValues).toHaveLength(1);
		const set = updateValues[0];
		expect(render(set.details).sql).toMatch(
			/json_remove\("audit_log"\."details", '\$\.name', '\$\.email'\)/
		);
		expect(set.subjectLabel).toBeNull();

		const { sql, params } = render(updateWheres[0]);
		expect(sql).toContain('"audit_log"."action" = ?');
		expect(sql).toContain('"audit_log"."created_at" < ?');
		expect(sql).toMatch(/json_type\("audit_log"\."details", '\$\.name'\) is not null/);
		expect(sql).toMatch(/json_type\("audit_log"\."details", '\$\.email'\) is not null/);
		expect(params).toContain('user.purged');
		expect(params).toContain(cutoffSeconds);
	});
});

describe('the only code that deletes from audit_log', () => {
	const srcRoot = new URL('../../../', import.meta.url).pathname;

	function sources(dir: string): string[] {
		return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
			const path = join(dir, e.name);
			if (e.isDirectory()) return sources(path);
			return /\.(ts|svelte)$/.test(e.name) && !/\.spec\.ts$/.test(e.name) ? [path] : [];
		});
	}

	it('is the retention sweep', () => {
		const deleters = sources(srcRoot)
			.filter((file) =>
				/\.delete\(\s*auditLog\b|delete\s+from\s+["`]?audit_log/i.test(readFileSync(file, 'utf8'))
			)
			.map((file) => relative(srcRoot, file));
		expect(deleters).toEqual(['lib/server/audit/audit-retention.ts']);
	});
});
