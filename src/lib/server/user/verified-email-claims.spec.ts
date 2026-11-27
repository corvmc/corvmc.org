import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
const captureException = vi.fn();
vi.mock('#lib/server/sentry.js', () => ({
	captureException: (...a: unknown[]) => captureException(...a)
}));
const linkExistingSubscriberToUser = vi.fn(async () => null);
vi.mock('#lib/server/marketing/subscriber-service.js', () => ({
	linkExistingSubscriberToUser: (...a: unknown[]) => linkExistingSubscriberToUser(...(a as []))
}));
const linkGuestTicketsToUser = vi.fn(async () => 0);
vi.mock('#lib/server/ticket/ticket-service.js', () => ({
	linkGuestTicketsToUser: (...a: unknown[]) => linkGuestTicketsToUser(...(a as []))
}));

const { claimVerifiedEmail, verifiedAccountIdForEmail, purchaseOwnerId } =
	await import('./verified-email-claims');

function account(id: string, email: string, opts: { verified?: boolean; deleted?: boolean } = {}) {
	sqlite
		.prepare(
			`insert into user (id, name, email, email_verified, deleted_at, created_at, updated_at)
			 values (?, ?, ?, ?, ?, 0, 0)`
		)
		.run(id, id, email, opts.verified ? 1 : 0, opts.deleted ? 1 : null);
}

beforeEach(() => {
	vi.clearAllMocks();
	sqlite.exec('delete from user');
});

describe('claimVerifiedEmail', () => {
	it('runs every claim for the address', async () => {
		await claimVerifiedEmail('user-1', 'alice@example.com');

		expect(linkExistingSubscriberToUser).toHaveBeenCalledWith('user-1', 'alice@example.com');
		expect(linkGuestTicketsToUser).toHaveBeenCalledWith('user-1', 'alice@example.com');
	});

	it('still links tickets when the subscriber link throws', async () => {
		linkExistingSubscriberToUser.mockRejectedValueOnce(new Error('boom'));

		await expect(claimVerifiedEmail('user-1', 'alice@example.com')).resolves.toBeUndefined();

		expect(linkGuestTicketsToUser).toHaveBeenCalledOnce();
		expect(captureException).toHaveBeenCalledOnce();
	});

	it('still links the subscriber when the ticket link throws', async () => {
		linkGuestTicketsToUser.mockRejectedValueOnce(new Error('boom'));

		await expect(claimVerifiedEmail('user-1', 'alice@example.com')).resolves.toBeUndefined();

		expect(linkExistingSubscriberToUser).toHaveBeenCalledOnce();
		expect(captureException).toHaveBeenCalledOnce();
	});
});

describe('verifiedAccountIdForEmail', () => {
	it('finds a verified live account whatever the case of the address', async () => {
		account('user-1', 'alice@example.com', { verified: true });

		expect(await verifiedAccountIdForEmail(' Alice@Example.com ')).toBe('user-1');
	});

	it('ignores unverified, deleted and unknown addresses', async () => {
		account('user-1', 'alice@example.com');
		account('user-2', 'bob@example.com', { verified: true, deleted: true });

		expect(await verifiedAccountIdForEmail('alice@example.com')).toBeNull();
		expect(await verifiedAccountIdForEmail('bob@example.com')).toBeNull();
		expect(await verifiedAccountIdForEmail('nobody@example.com')).toBeNull();
	});
});

describe('purchaseOwnerId', () => {
	it('keeps the signed-in buyer without looking anyone up', async () => {
		account('user-2', 'alice@example.com', { verified: true });

		expect(await purchaseOwnerId('user-1', 'alice@example.com')).toBe('user-1');
	});

	it('gives a guest purchase to the verified account under the address', async () => {
		account('user-2', 'alice@example.com', { verified: true });

		expect(await purchaseOwnerId(undefined, 'alice@example.com')).toBe('user-2');
	});

	it('leaves a guest purchase unowned when no verified account holds the address', async () => {
		account('user-2', 'alice@example.com');

		expect(await purchaseOwnerId(null, 'alice@example.com')).toBeUndefined();
	});
});
