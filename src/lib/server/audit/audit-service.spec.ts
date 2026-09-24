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

const { recordAuditEntry, listAuditEntriesForSubject, listAuditEntries } =
	await import('./audit-service');

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

describe('listAuditEntries', () => {
	/** Pacific noon on the given day, so the date filters have no edge to fall off. */
	function at(id: string, isoDay: string) {
		sqlite
			.prepare(`update audit_log set created_at = ? where id = ?`)
			.run(Math.floor(new Date(`${isoDay}T19:00:00Z`).getTime() / 1000), id);
	}

	async function seed() {
		insertUser('staff-2', 'Riley Admin');
		await recordAuditEntry({
			action: 'user.reactivated',
			subject: { type: 'user', id: 'member-1', label: 'Jordan Member' },
			details: { subscription: 'none' }
		});
		requestUser = { id: 'staff-2', name: 'Riley Admin', email: 'riley@example.com' };
		await recordAuditEntry({
			action: 'credits.adjusted',
			subject: { type: 'user', id: 'gone-1', label: 'Purged Person' },
			details: { creditType: 'free_hours', delta: 2, balanceAfter: 2, description: 'x' }
		});
		const ids = sqlite.prepare(`select id, action from audit_log`).all() as {
			id: string;
			action: string;
		}[];
		at(ids.find((r) => r.action === 'user.reactivated')!.id, '2026-09-01');
		at(ids.find((r) => r.action === 'credits.adjusted')!.id, '2026-09-10');
	}

	it('lists every subject newest first, with a true total', async () => {
		await seed();
		const { rows, pagination } = await listAuditEntries({});
		expect(rows.map((r) => r.action)).toEqual(['credits.adjusted', 'user.reactivated']);
		expect(pagination.total).toBe(2);
	});

	it('filters by action', async () => {
		await seed();
		const { rows } = await listAuditEntries({ action: 'user.reactivated' });
		expect(rows.map((r) => r.action)).toEqual(['user.reactivated']);
	});

	it('searches the actor by name or email, including a staffer since purged', async () => {
		await seed();
		expect((await listAuditEntries({ actor: 'riley@' })).rows).toHaveLength(1);
		sqlite.exec(`delete from user where id = 'staff-1'`);
		const { rows } = await listAuditEntries({ actor: 'Sam' });
		expect(rows.map((r) => r.actorName)).toEqual(['Sam Staff']);
	});

	it('bounds by whole local days, inclusive', async () => {
		await seed();
		expect((await listAuditEntries({ from: '2026-09-10' })).rows).toHaveLength(1);
		expect((await listAuditEntries({ to: '2026-09-01' })).rows).toHaveLength(1);
		expect((await listAuditEntries({ from: '2026-09-02', to: '2026-09-09' })).rows).toEqual([]);
	});

	it('paginates server-side', async () => {
		await seed();
		const { rows, pagination } = await listAuditEntries({}, { page: 2, pageSize: 1 });
		expect(rows.map((r) => r.action)).toEqual(['user.reactivated']);
		expect(pagination).toMatchObject({ page: 2, totalPages: 2 });
	});

	it('links a live subject and actor, and falls back to stored labels when either is gone', async () => {
		await seed();
		const [purged, live] = (await listAuditEntries({})).rows;
		expect(live.subject).toMatchObject({ type: 'member', id: 'member-1', title: 'Jordan Member' });
		expect(live.actor).toMatchObject({ type: 'member', id: 'staff-1', title: 'Sam Staff' });
		expect(purged.subject).toMatchObject({ id: null, title: 'Purged Person' });
	});

	it('gives a band subject a band ref, not a member one', async () => {
		sqlite.exec(`insert into "group" (id, name, slug) values ('band-1', 'The Velvets', 'velvets')`);
		sqlite.exec(
			`insert into audit_log (id, action, actor_name, actor_email, subject_type, subject_id, subject_label, details)
			 values ('a-band', 'user.purged', 'Sam Staff', '', 'band', 'band-1', 'The Velvets', '{}')`
		);
		const [row] = (await listAuditEntries({})).rows;
		expect(row.subject).toMatchObject({ type: 'band', id: 'band-1', title: 'The Velvets' });
		sqlite.exec(`delete from "group" where id = 'band-1'`);
	});

	it('names System as the actor when nobody was signed in', async () => {
		outsideRequest = true;
		await recordAuditEntry({
			action: 'user.reactivated',
			subject: { type: 'user', id: 'member-1' },
			details: { subscription: 'none' }
		});
		const [row] = (await listAuditEntries({})).rows;
		expect(row.actor).toMatchObject({ id: null, title: 'System' });
	});
});
