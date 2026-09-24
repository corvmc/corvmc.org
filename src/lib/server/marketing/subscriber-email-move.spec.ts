import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Moving a member's linked subscriber row to a new address, against a real
 * SQLite: the merge is a set of `WHERE`s over two rows and their audiences.
 */
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

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

const { moveLinkedSubscriberEmail } = await import('./subscriber-service');
const { subscriber, audience, audienceMember } = await import('$lib/server/db/schema/marketing');
const { user } = await import('$lib/server/db/schema/authentication');
const { eq } = await import('drizzle-orm');

const MEMBER = 'usr-member';
const OLD = 'jordan@exmaple.com';
const NEW = 'jordan@example.com';

beforeEach(async () => {
	for (const t of ['audience_member', 'audience', 'subscriber', 'user']) {
		sqlite.exec(`delete from ${t}`);
	}
	await testDb.insert(user).values([
		{ id: MEMBER, name: 'Jordan', email: NEW, emailVerified: true },
		{ id: 'usr-other', name: 'Other', email: 'other@example.com', emailVerified: true }
	] as never);
	await testDb.insert(audience).values([
		{ id: 'aud-news', name: 'News', slug: 'news' },
		{ id: 'aud-shows', name: 'Shows', slug: 'shows' }
	]);
});

async function rowsFor(userId: string) {
	return testDb.select().from(subscriber).where(eq(subscriber.userId, userId));
}

describe('moveLinkedSubscriberEmail', () => {
	it('rewrites the linked row when nothing holds the new address', async () => {
		await testDb.insert(subscriber).values({ id: 'sub-old', email: OLD, userId: MEMBER });

		expect(await moveLinkedSubscriberEmail(MEMBER, OLD, NEW)).toBe('moved');
		expect(await rowsFor(MEMBER)).toMatchObject([{ id: 'sub-old', email: NEW }]);
	});

	it('merges into an unclaimed row at the new address, keeping every audience once', async () => {
		await testDb.insert(subscriber).values([
			{
				id: 'sub-old',
				email: OLD,
				userId: MEMBER,
				suppressedAt: new Date(),
				suppressionReason: 'unsubscribe'
			},
			{ id: 'sub-new', email: NEW, userId: null }
		]);
		await testDb.insert(audienceMember).values([
			{ subscriberId: 'sub-old', audienceId: 'aud-news' },
			{ subscriberId: 'sub-old', audienceId: 'aud-shows' },
			{ subscriberId: 'sub-new', audienceId: 'aud-news' }
		]);

		expect(await moveLinkedSubscriberEmail(MEMBER, OLD, NEW)).toBe('merged');

		const rows = await rowsFor(MEMBER);
		expect(rows).toMatchObject([{ id: 'sub-new', email: NEW, suppressionReason: 'unsubscribe' }]);
		const memberships = await testDb
			.select({ audienceId: audienceMember.audienceId })
			.from(audienceMember)
			.where(eq(audienceMember.subscriberId, 'sub-new'));
		expect(memberships.map((m) => m.audienceId).sort()).toEqual(['aud-news', 'aud-shows']);
		expect(await testDb.select().from(subscriber).where(eq(subscriber.id, 'sub-old'))).toEqual([]);
	});

	it('does not carry a bounce from the old address to the new one', async () => {
		await testDb.insert(subscriber).values([
			{
				id: 'sub-old',
				email: OLD,
				userId: MEMBER,
				suppressedAt: new Date(),
				suppressionReason: 'bounce'
			},
			{ id: 'sub-new', email: NEW, userId: null }
		]);

		await moveLinkedSubscriberEmail(MEMBER, OLD, NEW);

		expect(await rowsFor(MEMBER)).toMatchObject([{ id: 'sub-new', suppressedAt: null }]);
	});

	it('leaves both rows alone when another account holds the new address', async () => {
		await testDb.insert(subscriber).values([
			{ id: 'sub-old', email: OLD, userId: MEMBER },
			{ id: 'sub-new', email: NEW, userId: 'usr-other' }
		]);

		expect(await moveLinkedSubscriberEmail(MEMBER, OLD, NEW)).toBe('none');
		expect(await rowsFor(MEMBER)).toMatchObject([{ id: 'sub-old', email: OLD }]);
	});

	it('does nothing when the member has no row at the old address', async () => {
		expect(await moveLinkedSubscriberEmail(MEMBER, OLD, NEW)).toBe('none');
	});
});
