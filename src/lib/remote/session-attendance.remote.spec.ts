import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { z } from 'zod';

/**
 * The guard on marking attendance, run for real: `requireProgramRole` reads the
 * roster from the same SQLite the write would land in, so a member, a band
 * admin and a lead of another program are each refused by the actual rule.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});
vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

let currentUser: { id: string } | null = null;

// Marked as kit marks them: a `.remote` module may export only remote functions.
vi.mock('$app/server', () => {
	type Handler = (...a: unknown[]) => unknown;
	const remote = <T extends object>(type: string, fn: T) => Object.assign(fn, { __: { type } });
	const mutation = (type: string) => (schema: z.ZodType, handler: Handler) =>
		remote(type, async (raw: unknown) => handler(schema.parse(raw), {}));
	return {
		getRequestEvent: () => ({ locals: { user: currentUser }, url: new URL('http://x/') }),
		form: mutation('form'),
		command: mutation('command'),
		query: (schema: z.ZodType, handler: Handler) =>
			remote('query', (raw: unknown) => {
				const p = Promise.resolve().then(() => handler(schema.parse(raw)));
				p.catch(() => undefined);
				return Object.assign(p, { refresh: async () => undefined });
			})
	};
});

const remotes = (await import('./session-attendance.remote')) as unknown as Record<
	string,
	(arg: unknown) => Promise<unknown>
>;

const statusOf = async (p: Promise<unknown>) => {
	try {
		await p;
	} catch (e) {
		return (e as { status?: number }).status ?? 0;
	}
	return 200;
};

const marked = () =>
	(
		sqlite.prepare(`select user_id from event_attendance order by user_id`).all() as {
			user_id: string;
		}[]
	).map((r) => r.user_id);

beforeEach(() => {
	for (const t of ['event_attendance', 'event_group', 'event_listing', 'group_member'])
		sqlite.exec(`delete from ${t}`);
	sqlite.exec('delete from "group"');
	sqlite.exec('delete from user');
	sqlite.exec(
		`insert into user (id, name, email) values
			('lead', 'Lee', 'lee@example.com'),
			('ada', 'Ada', 'ada@example.com'),
			('other-lead', 'Ola', 'ola@example.com')`
	);
	sqlite.exec(
		`insert into "group" (id, name, slug, kind) values
			('club', 'Film Club', 'film-club', 'club'),
			('other', 'Other Club', 'other-club', 'club'),
			('band', 'The Velvets', 'the-velvets', 'band')`
	);
	sqlite.exec(
		`insert into group_member (group_id, user_id, role, status) values
			('club', 'lead', 'admin', 'active'),
			('club', 'ada', 'member', 'active'),
			('other', 'other-lead', 'admin', 'active'),
			('band', 'ada', 'owner', 'active')`
	);
	sqlite.exec(
		`insert into event_listing (id, title, starts_at, ends_at, status, source, kind, group_id, created_by_user_id)
		 values ('s1', 'Session', 1000, 2000, 'published', 'group', 'meeting', 'club', 'lead'),
		        ('gone', 'Session', 1000, 2000, 'cancelled', 'group', 'meeting', 'club', 'lead')`
	);
});

const mark = (groupId: string, eventId = 's1') =>
	remotes.markSessionAttendance({ groupId, eventId, attended: ['ada'] });

describe('marking attendance', () => {
	it('lets the program lead mark', async () => {
		currentUser = { id: 'lead' };
		expect(await statusOf(mark('club'))).toBe(200);
		expect(marked()).toEqual(['ada']);
	});

	it('refuses a plain member of the program', async () => {
		currentUser = { id: 'ada' };
		expect(await statusOf(mark('club'))).toBe(403);
		expect(marked()).toEqual([]);
	});

	it('refuses a lead of another program naming their own group', async () => {
		currentUser = { id: 'other-lead' };
		expect(await statusOf(mark('other'))).toBe(404);
		expect(marked()).toEqual([]);
	});

	it('refuses a band owner, whose group is not a program', async () => {
		currentUser = { id: 'ada' };
		expect(await statusOf(mark('band'))).toBe(404);
		expect(marked()).toEqual([]);
	});

	it('refuses a cancelled session', async () => {
		currentUser = { id: 'lead' };
		expect(await statusOf(mark('club', 'gone'))).toBe(409);
		expect(marked()).toEqual([]);
	});

	it('refuses the list to a plain member', async () => {
		currentUser = { id: 'ada' };
		expect(await statusOf(remotes.getSessionAttendance({ groupId: 'club', eventId: 's1' }))).toBe(
			403
		);
	});
});
