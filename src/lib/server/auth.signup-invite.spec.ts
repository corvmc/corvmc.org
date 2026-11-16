import { describe, it, expect, vi, beforeEach } from 'vitest';

// Invites match on email (#2165), so a sign-up from an invite link must use the
// address the invite went to, or the account never joins the group (#3049).
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('#lib/server/turnstile.js', () => ({ verifyTurnstile: vi.fn(async () => true) }));

const { beforeAuth, INVITE_EMAIL_MISMATCH_CODE } = await import('./auth');

const signUp = (email: string, inviteToken?: string) => ({
	path: '/sign-up/email',
	body: { email, password: 'x', name: 'N' },
	headers: new Headers(inviteToken ? { 'x-invite-token': inviteToken } : {}),
	context: { password: { verify: vi.fn(async () => true) } }
});

const future = Math.floor(Date.now() / 1000) + 86400;

beforeEach(() => {
	sqlite.exec(`delete from group_invite; delete from "group";`);
	sqlite.exec(
		`insert into "group" (id, kind, name, slug) values ('g1','band','The Band','the-band')`
	);
	sqlite.exec(
		`insert into group_invite (id, email, token, group_id, role, status, expires_at)
		 values ('i1','invited@example.com','tok-live','g1','member','pending',${future})`
	);
});

describe('sign-up from an invite link', () => {
	it('refuses an address other than the invited one', async () => {
		await expect(beforeAuth(signUp('personal@example.com', 'tok-live'))).rejects.toMatchObject({
			body: expect.objectContaining({ code: INVITE_EMAIL_MISMATCH_CODE })
		});
	});

	it('accepts the invited address, whatever its case', async () => {
		await expect(beforeAuth(signUp(' Invited@Example.com ', 'tok-live'))).resolves.toBeUndefined();
	});

	it('lets a dead token through, as the page shows no invite for it', async () => {
		sqlite.exec(`update group_invite set status = 'accepted'`);
		await expect(beforeAuth(signUp('personal@example.com', 'tok-live'))).resolves.toBeUndefined();
		await expect(beforeAuth(signUp('personal@example.com', 'unknown'))).resolves.toBeUndefined();
	});

	it('leaves a sign-up without a token alone', async () => {
		await expect(beforeAuth(signUp('personal@example.com'))).resolves.toBeUndefined();
	});
});
