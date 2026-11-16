import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Purging a member something still points at, against a real SQLite behind the D1 driver. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite({ foreignKeys: true });
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/audit/audit-service.js', () => ({ recordAuditEntry: vi.fn() }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));

const { purgeUser, UserHasLinkedRecordsError } = await import('./user-service');

beforeEach(() => {
	sqlite.exec('delete from campaign');
	sqlite.exec('delete from user');
	sqlite.exec(
		`insert into user (id, name, email, deleted_at) values ('user-1', 'Gone', 'gone@example.com', unixepoch())`
	);
});

describe('purgeUser', () => {
	it('names the linked records when a no-action reference blocks the delete', async () => {
		sqlite.exec(
			`insert into campaign (id, subject, markdown_body, html_body, sent_by_id)
			 values ('c-1', 'S', 'M', 'H', 'user-1')`
		);
		await expect(purgeUser('user-1')).rejects.toBeInstanceOf(UserHasLinkedRecordsError);
	});

	it('deletes a member nothing blocks', async () => {
		await purgeUser('user-1');
		expect(sqlite.prepare(`select count(*) as n from user`).get()).toEqual({ n: 0 });
	});
});
