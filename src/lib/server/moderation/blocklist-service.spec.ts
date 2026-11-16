import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const { blockEmail, findBlockedEmail, recordRefusedSignup, unblockEmail, unblockForRemoval } =
	await import('./blocklist-service');

type Sub = { suppressed_at: number | null; suppression_reason: string | null };
const sub = (email: string) =>
	sqlite
		.prepare('select suppressed_at, suppression_reason from subscriber where email = ?')
		.get(email) as Sub;

function subscriber(email: string, reason: string | null = null) {
	sqlite
		.prepare(
			'insert into subscriber (id, email, suppressed_at, suppression_reason) values (?, ?, ?, ?)'
		)
		.run(crypto.randomUUID(), email, reason ? 1 : null, reason);
}

beforeEach(() => {
	sqlite.exec('delete from email_blocklist; delete from subscriber;');
});

describe('blockEmail', () => {
	it('matches the address case- and space-insensitively', async () => {
		await blockEmail({ email: ' Spam@Example.com ', source: 'staff', addedByUserId: null });
		expect(await findBlockedEmail('spam@example.COM')).toMatchObject({ source: 'staff' });
		expect(await findBlockedEmail('other@example.com')).toBeNull();
	});

	it('keeps the first entry when the address is blocked twice', async () => {
		await blockEmail({ email: 'a@x.com', source: 'staff', addedByUserId: null, note: 'first' });
		await blockEmail({ email: 'a@x.com', source: 'ban', addedByUserId: null, note: 'second' });
		expect(await findBlockedEmail('a@x.com')).toMatchObject({ note: 'first', source: 'staff' });
	});

	it('suppresses a deliverable subscriber, and unblocking clears only that', async () => {
		subscriber('a@x.com');
		await blockEmail({ email: 'a@x.com', source: 'staff', addedByUserId: null });
		expect(sub('a@x.com').suppression_reason).toBe('blocked');

		const entry = await findBlockedEmail('a@x.com');
		await unblockEmail(entry!.id);
		expect(sub('a@x.com')).toEqual({ suppressed_at: null, suppression_reason: null });
	});

	it('leaves a bounce in place on block and on unblock', async () => {
		subscriber('b@x.com', 'bounce');
		await blockEmail({ email: 'b@x.com', source: 'staff', addedByUserId: null });
		await unblockEmail((await findBlockedEmail('b@x.com'))!.id);
		expect(sub('b@x.com').suppression_reason).toBe('bounce');
	});
});

describe('recordRefusedSignup', () => {
	it('counts each refusal on the entry', async () => {
		await blockEmail({ email: 'a@x.com', source: 'staff', addedByUserId: null });
		const entry = (await findBlockedEmail('a@x.com'))!;
		await recordRefusedSignup(entry.id, new Date('2026-11-01T00:00:00Z'));
		await recordRefusedSignup(entry.id, new Date('2026-11-02T00:00:00Z'));
		expect(await findBlockedEmail('a@x.com')).toMatchObject({
			refusedCount: 2,
			lastRefusedAt: new Date('2026-11-02T00:00:00Z')
		});
	});
});

describe('unblockForRemoval', () => {
	it('removes only the entry the ban added', async () => {
		sqlite.exec(`
			insert into user (id, name, email, email_verified, created_at, updated_at) values ('u1','M','m@x.com',0,0,0);
			insert into content_flag (id, entity_type, entity_id, reason) values ('f1','member_profile','u1','x');
			insert into account_removal (id, user_id, kind, reason, flag_id) values ('r1','u1','ban','x','f1');
		`);
		await blockEmail({ email: 'm@x.com', source: 'ban', addedByUserId: null, removalId: 'r1' });
		await blockEmail({ email: 'alt@x.com', source: 'staff', addedByUserId: null });
		await unblockForRemoval('r1');
		expect(await findBlockedEmail('m@x.com')).toBeNull();
		expect(await findBlockedEmail('alt@x.com')).not.toBeNull();
		sqlite.exec(
			'delete from email_blocklist; delete from account_removal; delete from content_flag; delete from user;'
		);
	});
});
