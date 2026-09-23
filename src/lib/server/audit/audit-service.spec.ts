import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The audit log against a real SQLite: the row has to survive its actor and
 * its subject being purged, which only real foreign keys can show.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite({ foreignKeys: true });
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const captureException = vi.fn();
vi.mock('$lib/server/sentry', () => ({ captureException }));

let requestUser: { id: string; name: string; email: string } | null = null;
let outsideRequest = false;
vi.mock('$app/server', () => ({
	getRequestEvent: () => {
		if (outsideRequest) throw new Error('Can only read the current request event inside a request');
		return { locals: { user: requestUser } };
	}
}));

const { recordAuditEntry, listAuditEntriesForSubject } = await import('./audit-service');

function insertUser(id: string, name: string) {
	sqlite
		.prepare(
			`insert into user (id, name, email, email_verified, created_at, updated_at)
			 values (?, ?, ?, 0, unixepoch(), unixepoch())`
		)
		.run(id, name, `${id}@example.com`);
}

beforeEach(() => {
	sqlite.exec('delete from audit_log');
	sqlite.exec('delete from user');
	captureException.mockClear();
	outsideRequest = false;
	insertUser('staff-1', 'Sam Staff');
	insertUser('member-1', 'Jordan Member');
	requestUser = { id: 'staff-1', name: 'Sam Staff', email: 'staff-1@example.com' };
});

describe('recordAuditEntry', () => {
	it('attributes the entry to the signed-in user, copying their name and email', async () => {
		await recordAuditEntry({
			action: 'user.roles_changed',
			subject: { type: 'user', id: 'member-1', label: 'Jordan Member' },
			details: { added: ['staff'], removed: [] }
		});

		const [row] = await listAuditEntriesForSubject('user', 'member-1');
		expect(row).toMatchObject({
			action: 'user.roles_changed',
			actorUserId: 'staff-1',
			actorName: 'Sam Staff',
			actorEmail: 'staff-1@example.com',
			subjectLabel: 'Jordan Member',
			details: { added: ['staff'], removed: [] }
		});
		expect(row.createdAt).toBeInstanceOf(Date);
	});

	it('records "System" when nobody is signed in or there is no request at all', async () => {
		outsideRequest = true;
		await recordAuditEntry({
			action: 'user.reactivated',
			subject: { type: 'user', id: 'member-1' },
			details: { subscription: 'none' }
		});

		const [row] = await listAuditEntriesForSubject('user', 'member-1');
		expect(row).toMatchObject({ actorUserId: null, actorName: 'System', actorEmail: '' });
	});

	it('never throws: a failed write is reported and swallowed', async () => {
		sqlite.exec('drop table audit_log');
		try {
			await expect(
				recordAuditEntry({
					action: 'user.reactivated',
					subject: { type: 'user', id: 'member-1' },
					details: { subscription: 'none' }
				})
			).resolves.toBeUndefined();
			expect(captureException).toHaveBeenCalledTimes(1);
		} finally {
			// Rebuild for the tests after this one.
			const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
			const fresh = migratedSqlite().sqlite;
			const ddl = fresh
				.prepare(`select sql from sqlite_master where name like 'audit_log%' and sql is not null`)
				.all() as { sql: string }[];
			for (const { sql } of ddl) sqlite.exec(sql);
		}
	});

	it('refuses an oversized payload rather than storing it', async () => {
		await recordAuditEntry({
			action: 'credits.adjusted',
			subject: { type: 'user', id: 'member-1' },
			details: {
				creditType: 'free_hours',
				delta: 1,
				balanceAfter: 1,
				description: 'x'.repeat(5000)
			}
		});

		expect(await listAuditEntriesForSubject('user', 'member-1')).toEqual([]);
		expect(captureException).toHaveBeenCalledTimes(1);
	});

	it('truncates a long subject label to 200 characters', async () => {
		await recordAuditEntry({
			action: 'user.reactivated',
			subject: { type: 'user', id: 'member-1', label: 'y'.repeat(300) },
			details: { subscription: 'none' }
		});
		const [row] = await listAuditEntriesForSubject('user', 'member-1');
		expect(row.subjectLabel).toHaveLength(200);
	});

	it('survives purging both the actor and the subject', async () => {
		await recordAuditEntry({
			action: 'user.purged',
			subject: { type: 'user', id: 'member-1', label: 'Jordan Member' },
			details: { name: 'Jordan Member', email: 'member-1@example.com' }
		});
		sqlite.exec(`delete from user where id in ('member-1', 'staff-1')`);

		const [row] = await listAuditEntriesForSubject('user', 'member-1');
		expect(row).toMatchObject({ actorUserId: null, actorName: 'Sam Staff' });
	});
});

describe('listAuditEntriesForSubject', () => {
	it('returns only that subject, newest first, capped at the limit', async () => {
		insertUser('member-2', 'Other');
		for (let i = 0; i < 3; i++) {
			await recordAuditEntry({
				action: 'credits.adjusted',
				subject: { type: 'user', id: 'member-1' },
				details: { creditType: 'free_hours', delta: i + 1, balanceAfter: i + 1, description: 'x' }
			});
		}
		await recordAuditEntry({
			action: 'user.reactivated',
			subject: { type: 'user', id: 'member-2' },
			details: { subscription: 'none' }
		});
		// Same-second writes: order by the stored timestamp alone would be a tie.
		sqlite.exec(
			`update audit_log set created_at = created_at + json_extract(details, '$.delta')
			 where subject_id = 'member-1'`
		);

		const rows = await listAuditEntriesForSubject('user', 'member-1', { limit: 2 });
		expect(rows.map((r) => r.details)).toMatchObject([{ delta: 3 }, { delta: 2 }]);
	});
});
