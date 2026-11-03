import { describe, it, expect, vi, beforeEach } from 'vitest';

// Subscriber writes against a real SQLite: every rule here is a `WHERE`.
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const {
	suppressByEmail,
	suppressSelfService,
	clearSelfServiceSuppression,
	findOrCreateForUser,
	linkExistingSubscriberToUser,
	linkSubscriberToExistingUser
} = await import('./subscriber-service');

const T0 = 1_750_000_000;

function sub(
	id: string,
	email: string,
	opts: { userId?: string | null; suppressedAt?: number | null; reason?: string | null } = {}
) {
	sqlite
		.prepare(
			`insert into subscriber (id, email, name, user_id, suppressed_at, suppression_reason)
			 values (?, ?, null, ?, ?, ?)`
		)
		.run(id, email, opts.userId ?? null, opts.suppressedAt ?? null, opts.reason ?? null);
}

function account(id: string, email: string, deletedAt: number | null = null) {
	sqlite
		.prepare(`insert into user (id, name, email, deleted_at) values (?, 'Alice', ?, ?)`)
		.run(id, email, deletedAt);
}

type Row = {
	id: string;
	email: string;
	user_id: string | null;
	suppressed_at: number | null;
	suppression_reason: string | null;
};
const row = (id: string) =>
	sqlite.prepare('select * from subscriber where id = ?').get(id) as Row | undefined;
const subscriberCount = () =>
	(sqlite.prepare('select count(*) as n from subscriber').get() as { n: number }).n;

beforeEach(() => {
	vi.clearAllMocks();
	for (const t of ['audience_member', 'subscriber', 'user']) sqlite.exec(`delete from ${t}`);
});

describe('suppressByEmail', () => {
	it('normalizes the email and writes suppressedAt + reason', async () => {
		sub('sub-1', 'person@example.com');

		expect(await suppressByEmail('  Person@Example.COM ', 'bounce')).toBe(true);

		expect(row('sub-1')).toMatchObject({ suppression_reason: 'bounce' });
		expect(row('sub-1')?.suppressed_at).toEqual(expect.any(Number));
	});

	it('returns false when no subscriber matches (no-op)', async () => {
		sub('sub-1', 'person@example.com');

		expect(await suppressByEmail('unknown@example.com', 'complaint')).toBe(false);
		expect(row('sub-1')?.suppressed_at).toBeNull();
	});
});

describe('suppressSelfService', () => {
	it('suppresses the address with the reversible reason', async () => {
		sub('sub-1', 'a@example.com');
		sub('sub-2', 'b@example.com');

		await suppressSelfService('sub-1');

		expect(row('sub-1')?.suppression_reason).toBe('unsubscribe');
		expect(row('sub-1')?.suppressed_at).toEqual(expect.any(Number));
		expect(row('sub-2')?.suppressed_at).toBeNull();
	});

	// A bounce or complaint is a fact about the address reported by Postmark.
	// Overwriting it with the weaker reason would let a later opt-in resurrect
	// an address we know is undeliverable.
	it('only applies when not already suppressed, so it cannot mask a bounce', async () => {
		sub('sub-1', 'a@example.com', { suppressedAt: T0, reason: 'bounce' });

		await suppressSelfService('sub-1');

		expect(row('sub-1')).toMatchObject({ suppressed_at: T0, suppression_reason: 'bounce' });
	});
});

describe('clearSelfServiceSuppression', () => {
	it('lifts the suppression so opting back in actually delivers mail', async () => {
		sub('sub-1', 'a@example.com', { suppressedAt: T0, reason: 'unsubscribe' });

		await clearSelfServiceSuppression('sub-1');

		expect(row('sub-1')).toMatchObject({ suppressed_at: null, suppression_reason: null });
	});

	it('is scoped to self-service opt-outs and never clears a bounce or complaint', async () => {
		sub('sub-1', 'a@example.com', { suppressedAt: T0, reason: 'bounce' });
		sub('sub-2', 'b@example.com', { suppressedAt: T0, reason: 'complaint' });

		await clearSelfServiceSuppression('sub-1');
		await clearSelfServiceSuppression('sub-2');

		expect(row('sub-1')).toMatchObject({ suppressed_at: T0, suppression_reason: 'bounce' });
		expect(row('sub-2')).toMatchObject({ suppressed_at: T0, suppression_reason: 'complaint' });
	});
});

describe('linkExistingSubscriberToUser', () => {
	it('links the row already sitting under the signup address', async () => {
		sub('sub-1', 'alice@example.com');

		expect(await linkExistingSubscriberToUser('user-1', '  Alice@Example.COM ')).toBe('sub-1');
		expect(row('sub-1')?.user_id).toBe('user-1');
	});

	// The whole point of the link: a subscriber who opted out before they had an
	// account must still be opted out after signup.
	it('writes user_id and nothing else, so a prior unsubscribe survives', async () => {
		sub('sub-1', 'alice@example.com', { suppressedAt: T0, reason: 'unsubscribe' });

		await linkExistingSubscriberToUser('user-1', 'alice@example.com');

		expect(row('sub-1')).toMatchObject({
			user_id: 'user-1',
			suppressed_at: T0,
			suppression_reason: 'unsubscribe'
		});
	});

	it('links nothing when no subscriber matches the address', async () => {
		sub('sub-1', 'alice@example.com');

		expect(await linkExistingSubscriberToUser('user-1', 'nobody@example.com')).toBeNull();
		expect(row('sub-1')?.user_id).toBeNull();
	});

	// The predicate is what makes a replayed verification link harmless: a
	// claimed row cannot be taken over however many times it is presented.
	it('leaves a row another account already holds alone', async () => {
		sub('sub-1', 'alice@example.com', { userId: 'user-1' });

		expect(await linkExistingSubscriberToUser('user-2', 'alice@example.com')).toBeNull();
		expect(row('sub-1')?.user_id).toBe('user-1');
	});
});

// The account page's subscribe/unsubscribe path (#757): taking over a row
// somebody else's list signup created needs a proven address; making a fresh
// one under your own address does not.
describe('findOrCreateForUser', () => {
	it('returns the row this account already holds without writing anything', async () => {
		sub('sub-1', 'old@example.com', { userId: 'user-1' });
		sub('sub-9', 'alice@example.com');

		const found = await findOrCreateForUser('user-1', 'alice@example.com', 'Alice', {
			emailVerified: false
		});

		expect(found?.id).toBe('sub-1');
		expect(row('sub-9')?.user_id).toBeNull();
		expect(subscriberCount()).toBe(2);
	});

	// The claim vector: that row carries a stranger's audience memberships and
	// suppression state, and typing their address proves nothing about holding it.
	it('refuses to claim an unclaimed row for an unconfirmed address', async () => {
		sub('sub-9', 'alice@example.com');

		const found = await findOrCreateForUser('user-1', 'alice@example.com', 'Alice', {
			emailVerified: false
		});

		expect(found).toBeNull();
		expect(row('sub-9')?.user_id).toBeNull();
	});

	it('claims that same row once the address is confirmed', async () => {
		sub('sub-9', 'alice@example.com');

		const found = await findOrCreateForUser('user-1', 'alice@example.com', 'Alice', {
			emailVerified: true
		});

		expect(found).toMatchObject({ id: 'sub-9', userId: 'user-1' });
		expect(row('sub-9')?.user_id).toBe('user-1');
	});

	it('never hands over a row a different account holds, confirmed or not', async () => {
		sub('sub-9', 'alice@example.com', { userId: 'user-2' });

		expect(
			await findOrCreateForUser('user-1', 'alice@example.com', 'Alice', { emailVerified: true })
		).toBeNull();
		expect(row('sub-9')?.user_id).toBe('user-2');
	});

	// A fresh row takes nothing from anybody, so an unconfirmed member can still
	// manage the lists they choose themselves.
	it('creates and links a new row for an unconfirmed address with no row yet', async () => {
		const found = await findOrCreateForUser('user-1', 'Alice@example.com', 'Alice', {
			emailVerified: false
		});

		expect(found?.userId).toBe('user-1');
		expect(row(found!.id)).toMatchObject({ email: 'alice@example.com', user_id: 'user-1' });
	});
});

describe('linkSubscriberToExistingUser', () => {
	it('links a fresh subscription to the account already under that address', async () => {
		account('user-1', 'alice@example.com');
		sub('sub-1', 'alice@example.com');

		expect(await linkSubscriberToExistingUser('sub-1', ' Alice@Example.com ')).toBe('user-1');
		expect(row('sub-1')?.user_id).toBe('user-1');
	});

	it('leaves the row unlinked when no account matches', async () => {
		account('user-1', 'someone@example.com');
		sub('sub-1', 'nobody@example.com');

		expect(await linkSubscriberToExistingUser('sub-1', 'nobody@example.com')).toBeNull();
		expect(row('sub-1')?.user_id).toBeNull();
	});

	it('does not link to a deactivated account', async () => {
		account('user-1', 'alice@example.com', T0);
		sub('sub-1', 'alice@example.com');

		expect(await linkSubscriberToExistingUser('sub-1', 'alice@example.com')).toBeNull();
		expect(row('sub-1')?.user_id).toBeNull();
	});

	it('leaves a row another account already holds alone', async () => {
		account('user-1', 'alice@example.com');
		sub('sub-1', 'alice@example.com', { userId: 'user-2' });

		await linkSubscriberToExistingUser('sub-1', 'alice@example.com');

		expect(row('sub-1')?.user_id).toBe('user-2');
	});
});
