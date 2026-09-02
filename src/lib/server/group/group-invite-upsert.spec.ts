/**
 * Runs `createInvite`'s upsert against real SQLite, on the real migrated table.
 *
 * `idx_group_invite_pending` is a *partial* unique index, and SQLite accepts an
 * `ON CONFLICT` naming it only if the clause's own `WHERE` matches the index's.
 * Drizzle renders `targetWhere: eq(groupInvite.status, 'pending')` as a bound
 * `?`, which matches nothing — every call fails at runtime with
 *
 *   ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint
 *
 * and neither `pnpm check` nor a mocked unit test can see it, because both stop
 * at the shape of the query rather than at its meaning to the engine. Hence a
 * real database: the schema builds the statement, the committed migrations build
 * the table, and SQLite decides whether the two agree.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { drizzle as drizzleProxy } from 'drizzle-orm/sqlite-proxy';
import { drizzle as drizzleNode } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
import { sql } from 'drizzle-orm';
import { groupInvite } from '$lib/server/db/schema/group-invite';

const MIGRATIONS_FOLDER = join(import.meta.dirname, '..', '..', '..', '..', 'migrations');

let db: DatabaseSync;

/**
 * 30s, not the 10s default: this hook replays every committed migration, so it
 * gets monotonically slower with each one added and was already landing within
 * a few hundred ms of the default ceiling. Under parallel load it crossed it,
 * which surfaces as an unexplained hook timeout rather than anything about the
 * assertions below.
 */
beforeAll(() => {
	// The whole committed migration set, in memory — the same path
	// `db:migrate:local` takes, so the table here is the table that ships.
	db = new DatabaseSync(':memory:');
	migrate(drizzleNode({ client: db }), { migrationsFolder: MIGRATIONS_FOLDER });
	db.exec(`INSERT INTO "group" (id, name, slug) VALUES ('group-1', 'Test', 'test')`);
}, 30_000);

afterAll(() => db?.close());

/** The statement `createInvite` sends, built from the schema rather than retyped. */
function upsertSql(): string {
	const proxy = drizzleProxy(async () => ({ rows: [] }));
	const q = proxy
		.insert(groupInvite)
		.values({
			id: 'inv-1',
			email: 'alice@example.com',
			token: 'tok-1',
			groupId: 'group-1',
			role: 'member',
			position: null,
			invitedById: null,
			status: 'pending',
			expiresAt: new Date(1)
		})
		.onConflictDoUpdate({
			target: [groupInvite.groupId, groupInvite.email],
			targetWhere: sql`status = 'pending'`,
			set: { expiresAt: new Date(2), role: 'admin', position: 'Treasurer' }
		});
	return new SQLiteSyncDialect().sqlToQuery(q.getSQL()).sql;
}

describe('the group_invite upsert', () => {
	it('names the conflict target with a literal, not a bound parameter', () => {
		// The whole defect in one assertion: `where status = ?` compiles, type
		// checks, and throws on every call.
		expect(upsertSql()).toContain("where status = 'pending'");
	});

	it('is accepted by SQLite against the migrated index', () => {
		// Preparing is where the mismatch is rejected, before any row exists.
		expect(() => db.prepare(upsertSql())).not.toThrow();
	});

	const insert = (id: string, status: string, role = 'member', expiresAt = 10) =>
		db
			.prepare(
				`insert into group_invite (id, email, token, group_id, role, invited_by_id, status, expires_at)
				 values (?, 'alice@example.com', ?, 'group-1', ?, null, ?, ?)
				 on conflict (group_id, email) where status = 'pending'
				 do update set expires_at = excluded.expires_at, role = excluded.role`
			)
			.run(id, `tok-${id}`, role, status, expiresAt);

	it('refreshes the pending row instead of inserting a second one', () => {
		insert('inv-1', 'pending', 'member', 10);
		insert('inv-2', 'pending', 'admin', 20);

		expect(db.prepare('select id, role, expires_at from group_invite').all()).toEqual([
			{ id: 'inv-1', role: 'admin', expires_at: 20 }
		]);
		db.exec('delete from group_invite');
	});

	it('lets a revoked invitation sit beside a fresh pending one', () => {
		// What makes the index partial. Unconditional, it would refuse the second
		// invitation and there would be no way to re-invite anybody.
		insert('inv-1', 'revoked');
		expect(() => insert('inv-2', 'pending')).not.toThrow();
		expect(db.prepare('select count(*) as n from group_invite').get()).toEqual({ n: 2 });
		db.exec('delete from group_invite');
	});

	it('keeps an invitation whose sender is deleted', () => {
		// The column was NOT NULL *and* ON DELETE SET NULL — contradictory, so
		// deleting a user who had ever sent an invite failed outright. Phase 6's
		// rebuild made it nullable, which is what lets the SET NULL fire.
		db.exec(
			`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
			 VALUES ('sender-1', 'Alice', 'alice@corvmc.test', 0, 0, 0)`
		);
		db.exec(
			`INSERT INTO group_invite (id, email, token, group_id, role, invited_by_id, status, expires_at)
			 VALUES ('inv-1', 'bob@example.com', 'tok-1', 'group-1', 'member', 'sender-1', 'pending', 10)`
		);

		db.exec('PRAGMA foreign_keys = ON');
		expect(() => db.exec(`DELETE FROM "user" WHERE id = 'sender-1'`)).not.toThrow();
		expect(db.prepare('select invited_by_id from group_invite').all()).toEqual([
			{ invited_by_id: null }
		]);
		db.exec('delete from group_invite');
	});
});
