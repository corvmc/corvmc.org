import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

/**
 * Retention (#1468): an incident is deleted seven years after it happened
 * unless staff marked it `retain`, and every deletion is written to the audit
 * log, because the record itself no longer exists to say it was there.
 */

let deleteResults: unknown[][] = [];
let updateResults: unknown[][] = [];
let updateValues: Record<string, unknown>[] = [];
let insertValues: Record<string, unknown>[] = [];
let whereArgs: unknown[] = [];

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
		delete: vi.fn(() => chain(() => deleteResults.shift() ?? [])),
		update: vi.fn(() => ({
			set: (v: Record<string, unknown>) => {
				updateValues.push(v);
				return chain(() => updateResults.shift() ?? []);
			}
		})),
		insert: vi.fn(() => ({
			values: (v: Record<string, unknown>) => {
				insertValues.push(v);
				return chain(() => [v]);
			}
		}))
	}
}));

const recordAuditEntry = vi.fn();
vi.mock('$lib/server/audit/audit-service', () => ({
	recordAuditEntry: (...args: unknown[]) => recordAuditEntry(...args)
}));

const { sweepExpiredIncidents, setIncidentRetain, retentionCutoff, INCIDENT_RETENTION_YEARS } =
	await import('./incident-retention');
const { IncidentNotFoundError } = await import('./incident-service');

const dialect = new SQLiteSyncDialect();
const renderWhere = (i: number) => dialect.sqlToQuery(whereArgs[i] as SQL);
const staff = { id: 'staff-1', name: 'Pat Staff' };

beforeEach(() => {
	deleteResults = [];
	updateResults = [];
	updateValues = [];
	insertValues = [];
	whereArgs = [];
	recordAuditEntry.mockReset();
});

describe('retentionCutoff', () => {
	it('is seven years before now', () => {
		expect(INCIDENT_RETENTION_YEARS).toBe(7);
		const cutoff = retentionCutoff(new Date('2026-09-24T12:00:00Z'));
		expect(cutoff.toISOString()).toBe('2019-09-24T12:00:00.000Z');
	});
});

describe('sweepExpiredIncidents', () => {
	it('deletes only unretained incidents older than the cutoff', async () => {
		deleteResults = [[]];
		const now = new Date('2026-09-24T12:00:00Z');

		await sweepExpiredIncidents(now);

		const { sql, params } = renderWhere(0);
		expect(sql).toContain('"incident"."retain" = ?');
		expect(sql).toContain('"incident"."occurred_at" < ?');
		expect(params).toContain(0);
		expect(params).toContain(Math.floor(retentionCutoff(now).getTime() / 1000));
	});

	it('writes one audit entry per deleted incident, as the system', async () => {
		const occurredAt = new Date('2018-03-01T22:00:00Z');
		deleteResults = [
			[
				{ id: 'inc-1', summary: 'Cracked window', category: 'property_damage', occurredAt },
				{ id: 'inc-2', summary: 'Noise call', category: 'noise_complaint', occurredAt }
			]
		];

		const result = await sweepExpiredIncidents(new Date('2026-09-24T12:00:00Z'));

		expect(result).toEqual({ deleted: 2 });
		expect(recordAuditEntry).toHaveBeenCalledTimes(2);
		expect(recordAuditEntry.mock.calls[0][0]).toMatchObject({
			action: 'incident.deleted',
			subject: { type: 'incident', id: 'inc-1', label: 'Cracked window' },
			details: {
				category: 'property_damage',
				occurredAt: occurredAt.toISOString(),
				retentionYears: 7
			},
			actor: { id: null, name: 'System' }
		});
	});

	it('writes nothing when nothing expired', async () => {
		deleteResults = [[]];

		expect(await sweepExpiredIncidents(new Date())).toEqual({ deleted: 0 });
		expect(recordAuditEntry).not.toHaveBeenCalled();
	});
});

describe('setIncidentRetain', () => {
	it('marks the record retain and notes who did it and why', async () => {
		updateResults = [[{ id: 'inc-1', retain: true }]];

		await setIncidentRetain('inc-1', true, 'Open insurance claim', staff);

		expect(updateValues[0]).toMatchObject({ retain: true });
		expect(insertValues[0]).toMatchObject({ incidentId: 'inc-1', authorName: 'Pat Staff' });
		expect(String(insertValues[0].body)).toContain('Open insurance claim');
	});

	it('notes the release too, so the record says why it may now be deleted', async () => {
		updateResults = [[{ id: 'inc-1', retain: false }]];

		await setIncidentRetain('inc-1', false, 'Claim settled', staff);

		expect(updateValues[0]).toMatchObject({ retain: false });
		expect(String(insertValues[0].body)).toContain('Claim settled');
	});

	it('throws for an incident that does not exist', async () => {
		updateResults = [[]];

		await expect(setIncidentRetain('nope', true, 'x', staff)).rejects.toThrow(
			IncidentNotFoundError
		);
	});
});
