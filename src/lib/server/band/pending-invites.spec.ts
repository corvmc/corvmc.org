import { describe, it, expect, beforeEach, vi } from 'vitest';

/** The inviter is a join, so this runs against a real SQLite. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { listPendingInvites } = await import('./band-service');

beforeEach(() => {
	sqlite.exec(`
		delete from group_member;
		delete from "group";
		delete from "user";
		insert into "user" (id, name, email) values
			('wes', 'Wes Adeyemi', 'wes@example.com'),
			('dez', 'Dez Halloran', 'dez@example.com');
		insert into "group" (id, kind, name, slug, deleted_at) values
			('late', 'band', 'Late Bloomers', 'late-bloomers', null),
			('gone', 'band', 'Gone Band', 'gone-band', 1000),
			('film', 'club', 'Film Club', 'film-club', null);
		insert into group_member (id, group_id, user_id, role, status, invited_by_id) values
			('gm-1', 'late', 'dez', 'member', 'pending', 'wes'),
			('gm-2', 'gone', 'dez', 'member', 'pending', 'wes'),
			('gm-3', 'film', 'dez', 'member', 'pending', null),
			('gm-4', 'late', 'wes', 'owner', 'active', null);
	`);
});

describe('listPendingInvites', () => {
	// The class: an invitation surface that names neither group nor sender (#3052).
	it('names the group and the person who sent the invitation', async () => {
		const rows = await listPendingInvites('dez', ['band']);
		expect(rows).toEqual([
			{
				id: 'late',
				name: 'Late Bloomers',
				kind: 'band',
				role: 'member',
				invitedByName: 'Wes Adeyemi'
			}
		]);
	});

	it('reads every kind when none is given, with no inviter where none was kept', async () => {
		const rows = await listPendingInvites('dez');
		expect(rows.map((r) => [r.id, r.invitedByName])).toEqual([
			['film', null],
			['late', 'Wes Adeyemi']
		]);
	});

	it('leaves out active rows', async () => {
		expect(await listPendingInvites('wes')).toEqual([]);
	});
});
