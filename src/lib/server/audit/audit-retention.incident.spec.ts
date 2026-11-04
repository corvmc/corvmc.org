import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * An incident's own audit history outlives the 24-month sweep while the
 * incident exists and goes once the incident sweep has deleted it. The
 * predicates run against a real SQLite: a mocked `db` would agree either way.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { sweepAuditLog } = await import('./audit-retention');

const now = new Date('2026-09-24T12:00:00Z');
const old = Math.floor(new Date('2020-01-01T00:00:00Z').getTime() / 1000);
const recent = Math.floor(new Date('2026-09-01T00:00:00Z').getTime() / 1000);

function entry(id: string, action: string, subjectId: string, createdAt: number) {
	sqlite
		.prepare(
			`insert into audit_log (id, action, actor_name, actor_email, subject_type, subject_id, details, created_at)
			 values (?, ?, 'Pat', '', 'incident', ?, '{}', ?)`
		)
		.run(id, action, subjectId, createdAt);
}

const remaining = () =>
	(sqlite.prepare('select id from audit_log order by id').all() as { id: string }[]).map(
		(r) => r.id
	);

beforeEach(() => {
	sqlite.exec('delete from audit_log');
	sqlite.exec('delete from incident');
	sqlite.exec(
		`insert into incident (id, occurred_at, category, summary, description, reported_by_name)
		 values ('kept', ${old}, 'other', 'Kept', 'x', 'Pat')`
	);
});

describe('an incident’s audit history', () => {
	it('survives the 24-month cutoff while the incident exists', async () => {
		entry('reopened', 'incident.reopened', 'kept', old);
		entry('retained', 'incident.retention_changed', 'kept', old);

		await sweepAuditLog(now);

		expect(remaining()).toEqual(['reopened', 'retained']);
	});

	it('goes with the incident, however recent', async () => {
		entry('orphan', 'incident.retention_changed', 'gone', recent);
		entry('live', 'incident.reopened', 'kept', recent);

		const result = await sweepAuditLog(now);

		expect(remaining()).toEqual(['live']);
		expect(result.deleted).toBe(1);
	});

	it('leaves the deletion record to the ordinary 24-month rule', async () => {
		entry('deleted-old', 'incident.deleted', 'gone', old);
		entry('deleted-new', 'incident.deleted', 'gone', recent);

		await sweepAuditLog(now);

		expect(remaining()).toEqual(['deleted-new']);
	});
});
