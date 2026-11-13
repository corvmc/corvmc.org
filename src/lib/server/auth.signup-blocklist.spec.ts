import { describe, it, expect, vi, beforeEach } from 'vitest';

// The sign-up branch of the better-auth `before` hook against a real SQLite:
// a blocklisted address is refused and counted, and the list never reaches
// sign-in, so it cannot lock out an existing member.
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('#lib/server/turnstile.js', () => ({ verifyTurnstile: vi.fn(async () => true) }));

const { beforeAuth, BLOCKED_SIGNUP_CODE } = await import('./auth');
const { blockEmail } = await import('#lib/server/moderation/blocklist-service.js');

const ctx = (path: string, body: Record<string, unknown>) => ({
	path,
	body,
	headers: new Headers(),
	context: { password: { verify: vi.fn(async () => true) } }
});

const refusedCount = () =>
	(sqlite.prepare('select refused_count as n from email_blocklist').get() as { n: number }).n;

beforeEach(() => {
	sqlite.exec('delete from email_blocklist; delete from user;');
});

describe('sign-up against the blocklist', () => {
	it('refuses a blocklisted address, whatever its case, and counts the attempt', async () => {
		await blockEmail({ email: 'banned@example.com', source: 'staff', addedByUserId: null });

		await expect(
			beforeAuth(ctx('/sign-up/email', { email: ' Banned@Example.com ', password: 'x' }))
		).rejects.toMatchObject({ body: expect.objectContaining({ code: BLOCKED_SIGNUP_CODE }) });
		expect(refusedCount()).toBe(1);
	});

	it('lets any other address through', async () => {
		await blockEmail({ email: 'banned@example.com', source: 'staff', addedByUserId: null });
		await expect(
			beforeAuth(ctx('/sign-up/email', { email: 'new@example.com', password: 'x' }))
		).resolves.toBeUndefined();
		expect(refusedCount()).toBe(0);
	});

	it('does not refuse an active member signing in with a blocklisted address', async () => {
		sqlite.exec(
			`insert into user (id, name, email, email_verified, created_at, updated_at) values ('u1','M','member@example.com',1,0,0)`
		);
		await blockEmail({ email: 'member@example.com', source: 'staff', addedByUserId: null });

		await expect(
			beforeAuth(ctx('/sign-in/email', { email: 'member@example.com', password: 'x' }))
		).resolves.toBeUndefined();
		expect(refusedCount()).toBe(0);
	});
});
