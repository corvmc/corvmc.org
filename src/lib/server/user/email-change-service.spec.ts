import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Staff email change, against a real SQLite: whether a link still works is a
 * `WHERE` over `verification`, which a mocked `db` would agree with either way.
 */
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

// better-sqlite3 has no `batch`; sequential is enough to exercise the writes.
vi.mock('$lib/server/db', () => ({
	db: new Proxy(testDb, {
		get: (target, prop, receiver) =>
			prop === 'batch'
				? async (queries: PromiseLike<unknown>[]) => {
						for (const q of queries) await q;
					}
				: Reflect.get(target, prop, receiver)
	})
}));

vi.mock('$env/dynamic/private', () => ({ env: { BETTER_AUTH_SECRET: 'test-secret' } }));

const allowRateLimited = vi.fn(async () => true);
vi.mock('$lib/server/rate-limit', () => ({
	allowRateLimited: (...a: unknown[]) => allowRateLimited(...(a as []))
}));

const dispatchEmailOnly = vi.fn(async () => undefined);
vi.mock('$lib/server/notification/dispatcher', () => ({
	dispatchEmailOnly: (...a: unknown[]) => dispatchEmailOnly(...(a as []))
}));

const linkExistingSubscriberToUser = vi.fn(async () => null);
vi.mock('$lib/server/marketing/subscriber-service', () => ({
	linkExistingSubscriberToUser: (...a: unknown[]) => linkExistingSubscriberToUser(...(a as []))
}));

vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

const svc = await import('./email-change-service');
const { user, session } = await import('$lib/server/db/schema/authentication');
const { eq } = await import('drizzle-orm');

const MEMBER = 'usr-member';
const OTHER = 'usr-other';

/** The token from the most recent confirmation email. */
function lastToken(): string {
	const calls = dispatchEmailOnly.mock.calls as unknown as [{ email: { cta: { url: string } } }][];
	const url = calls.at(-1)![0].email.cta.url;
	return url.replace('/confirm-email/', '');
}

async function memberRow() {
	const [row] = await testDb.select().from(user).where(eq(user.id, MEMBER));
	return row;
}

beforeEach(async () => {
	allowRateLimited.mockReset().mockResolvedValue(true);
	dispatchEmailOnly.mockClear();
	linkExistingSubscriberToUser.mockClear();
	for (const t of ['verification', 'session', 'user']) sqlite.exec(`delete from ${t}`);
	await testDb.insert(user).values([
		{ id: MEMBER, name: 'Jordan', email: 'jordan@exmaple.com', emailVerified: false },
		{ id: OTHER, name: 'Other', email: 'taken@example.com', emailVerified: true }
	] as never);
	await testDb.insert(session).values({
		id: 'ses-1',
		token: 'tok-1',
		userId: MEMBER,
		expiresAt: new Date(Date.now() + 86_400_000)
	} as never);
});

describe('requestEmailChange', () => {
	it('mails a link to the new address and leaves the login untouched', async () => {
		const pending = await svc.requestEmailChange(MEMBER, '  Jordan@Example.com ');

		expect(pending.email).toBe('jordan@example.com');
		expect((await memberRow()).email).toBe('jordan@exmaple.com');
		expect(dispatchEmailOnly).toHaveBeenCalledWith(
			expect.objectContaining({ toEmail: 'jordan@example.com' })
		);
		expect(await svc.getPendingEmailChange(MEMBER)).toMatchObject({ email: 'jordan@example.com' });
	});

	it('refuses an address another account already uses', async () => {
		await expect(svc.requestEmailChange(MEMBER, 'taken@example.com')).rejects.toBeInstanceOf(
			svc.EmailChangeRejectedError
		);
		expect(dispatchEmailOnly).not.toHaveBeenCalled();
	});

	it('refuses the address the account already has', async () => {
		await expect(svc.requestEmailChange(MEMBER, 'JORDAN@exmaple.com')).rejects.toBeInstanceOf(
			svc.EmailChangeRejectedError
		);
	});

	it('refuses once the daily send cap is spent', async () => {
		allowRateLimited.mockResolvedValue(false);
		await expect(svc.requestEmailChange(MEMBER, 'jordan@example.com')).rejects.toBeInstanceOf(
			svc.EmailChangeRejectedError
		);
		expect(dispatchEmailOnly).not.toHaveBeenCalled();
	});

	it('throws not-found for an unknown account', async () => {
		await expect(svc.requestEmailChange('nobody', 'a@example.com')).rejects.toBeInstanceOf(
			svc.EmailChangeUserNotFoundError
		);
	});
});

describe('confirmEmailChange', () => {
	it('swaps the address, marks it verified, clears sessions and notifies the old address', async () => {
		await svc.requestEmailChange(MEMBER, 'jordan@example.com');
		const token = lastToken();

		expect(await svc.getEmailChangeRequest(token)).toEqual({ email: 'jordan@example.com' });
		expect(await svc.confirmEmailChange(token)).toEqual({
			status: 'changed',
			email: 'jordan@example.com'
		});

		const row = await memberRow();
		expect(row.email).toBe('jordan@example.com');
		expect(row.emailVerified).toBe(true);
		expect(await testDb.select().from(session).where(eq(session.userId, MEMBER))).toHaveLength(0);
		expect(dispatchEmailOnly).toHaveBeenLastCalledWith(
			expect.objectContaining({ toEmail: 'jordan@exmaple.com' })
		);
		expect(linkExistingSubscriberToUser).toHaveBeenCalledWith(MEMBER, 'jordan@example.com');
		expect(await svc.getPendingEmailChange(MEMBER)).toBeNull();
	});

	it('gives the old address a button that asks staff to reverse the change', async () => {
		await svc.requestEmailChange(MEMBER, 'jordan@example.com');
		await svc.confirmEmailChange(lastToken());

		const [[notice]] = dispatchEmailOnly.mock.calls.slice(-1) as unknown as [
			{ email: { cta?: { url: string; label: string }; paragraphs: { text: string }[] } }
		][];
		const url = new URL(notice.email.cta!.url);
		expect(url.protocol).toBe('mailto:');
		expect(url.pathname).toBe('contact@corvmc.org');
		expect(url.searchParams.get('subject')).toMatch(/reverse/i);
		expect(notice.email.cta!.label).toMatch(/reverse/i);
		expect(notice.email.paragraphs.map((p) => p.text).join(' ')).toMatch(/change it back/i);
	});

	it('works once', async () => {
		await svc.requestEmailChange(MEMBER, 'jordan@example.com');
		const token = lastToken();
		await svc.confirmEmailChange(token);

		expect(await svc.confirmEmailChange(token)).toEqual({ status: 'invalid' });
		expect(await svc.getEmailChangeRequest(token)).toBeNull();
	});

	it('is revoked by cancel', async () => {
		await svc.requestEmailChange(MEMBER, 'jordan@example.com');
		const token = lastToken();
		await svc.cancelEmailChange(MEMBER);

		expect(await svc.confirmEmailChange(token)).toEqual({ status: 'invalid' });
		expect((await memberRow()).email).toBe('jordan@exmaple.com');
	});

	it('is revoked by a newer request', async () => {
		await svc.requestEmailChange(MEMBER, 'jordan@example.com');
		const first = lastToken();
		await svc.requestEmailChange(MEMBER, 'jordan@example.org');

		expect(await svc.confirmEmailChange(first)).toEqual({ status: 'invalid' });
		expect(await svc.confirmEmailChange(lastToken())).toMatchObject({ status: 'changed' });
	});

	it('refuses an expired link', async () => {
		await svc.requestEmailChange(MEMBER, 'jordan@example.com');
		const token = lastToken();
		sqlite.exec(`update verification set expires_at = ${Math.floor(Date.now() / 1000) - 1}`);

		expect(await svc.confirmEmailChange(token)).toEqual({ status: 'invalid' });
	});

	it('refuses a tampered link', async () => {
		await svc.requestEmailChange(MEMBER, 'jordan@example.com');
		const decoded = Buffer.from(lastToken(), 'base64url').toString().split(':');
		const forged = Buffer.from(`${OTHER}:${decoded[1]}:${decoded[2]}`).toString('base64url');

		expect(await svc.confirmEmailChange(forged)).toEqual({ status: 'invalid' });
		expect(await svc.confirmEmailChange('not-a-token')).toEqual({ status: 'invalid' });
	});

	it('refuses an address taken between proposal and confirmation', async () => {
		await svc.requestEmailChange(MEMBER, 'jordan@example.com');
		const token = lastToken();
		await testDb.update(user).set({ email: 'jordan@example.com' }).where(eq(user.id, OTHER));

		expect(await svc.confirmEmailChange(token)).toEqual({ status: 'taken' });
		expect((await memberRow()).email).toBe('jordan@exmaple.com');
	});
});

describe('maskEmail', () => {
	it('keeps the first letter and the domain', () => {
		expect(svc.maskEmail('jordan@example.com')).toBe('j••••@example.com');
	});
});
