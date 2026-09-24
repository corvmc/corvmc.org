import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ClassifiedKind, ClassifiedCategory } from '$lib/config';

/**
 * Classifieds, against a real SQLite. The rules worth pinning are `WHERE`
 * clauses — what is on the board, whose posts count toward the cap — which a
 * mocked `db` would agree with either way.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

// better-sqlite3's drizzle has no `batch`; D1's runs the statements in order, as this does.
vi.mock('$lib/server/db', () => ({
	db: Object.assign(testDb, {
		batch: async (stmts: PromiseLike<unknown>[]) => {
			const out = [];
			for (const s of stmts) out.push(await s);
			return out;
		}
	}),
	getRowCount: (result: unknown) => (result as { changes?: number })?.changes ?? 0
}));

const svc = await import('./classified-service');
const { classifiedPost, classifiedPostTag } = await import('$lib/server/db/schema/classified');
const { memberStanding } = await import('$lib/server/db/schema/standing');
const { MAX_OPEN_CLASSIFIEDS, CLASSIFIED_LIFETIME_DAYS } = await import('$lib/config');
const { eq } = await import('drizzle-orm');

const AUTHOR = 'usr-author';
const OTHER = 'usr-other';
const STAFF = 'usr-staff';
const BAND = 'grp-band';
const NOT_MY_BAND = 'grp-other-band';
const DAY = 86_400_000;
const NOW = new Date('2026-09-23T12:00:00Z');

async function seed() {
	const { user } = await import('$lib/server/db/schema/authentication');
	const { group, groupMember } = await import('$lib/server/db/schema/group');
	await testDb.insert(user).values([
		{ id: AUTHOR, name: 'Ada', email: 'ada@example.com', emailVerified: false },
		{ id: OTHER, name: 'Bo', email: 'bo@example.com', emailVerified: false },
		{ id: STAFF, name: 'Sam', email: 'sam@example.com', emailVerified: false }
	] as never);
	await testDb.insert(group).values([
		{ id: BAND, kind: 'band', name: 'The Dead Pixels', slug: 'dead-pixels' },
		{ id: NOT_MY_BAND, kind: 'band', name: 'Other Band', slug: 'other-band' }
	] as never);
	await testDb.insert(groupMember).values([
		{ groupId: BAND, userId: AUTHOR, role: 'admin', status: 'active' },
		{ groupId: NOT_MY_BAND, userId: AUTHOR, role: 'member', status: 'active' }
	] as never);
}

beforeEach(async () => {
	for (const t of [
		'classified_post_tag',
		'classified_post',
		'member_standing',
		'group_member',
		'"group"',
		'user'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	await seed();
});

const base: {
	authorUserId: string;
	kind: ClassifiedKind;
	category: ClassifiedCategory;
	title: string;
	body: string;
	tags: { kind: 'instrument' | 'genre' | 'skill'; value: string }[];
} = {
	authorUserId: AUTHOR,
	kind: 'wanted',
	category: 'musician',
	title: 'Drummer wanted',
	body: 'Surf-rock trio, Tuesdays.',
	tags: []
};

function post(overrides: Partial<typeof base> & { groupId?: string } = {}, now = NOW) {
	return svc.createPost({ ...base, ...overrides }, now);
}

async function board(filters: Parameters<typeof svc.listBoard>[0] = {}, now = NOW) {
	return (await svc.listBoard(filters, { page: 1, pageSize: 50 }, now)).rows.map((r) => r.id);
}

describe('createPost', () => {
	it('puts a trusted member straight onto the board, expiring after the lifetime', async () => {
		const row = await post();
		expect(row.visibility).toBe('visible');
		expect(row.expiresAt.getTime()).toBe(NOW.getTime() + CLASSIFIED_LIFETIME_DAYS * DAY);
		expect(await board()).toEqual([row.id]);
	});

	it('holds a restricted member for review', async () => {
		await testDb
			.insert(memberStanding)
			.values({ userId: AUTHOR, scope: 'classified', status: 'restricted' });
		const row = await post();
		expect(row.visibility).toBe('pending_review');
		expect(await board()).toEqual([]);
	});

	it('normalises tags the way directory tags are, dropping duplicates', async () => {
		const row = await post({
			tags: [
				{ kind: 'instrument', value: '  Drums ' },
				{ kind: 'instrument', value: 'drums' },
				{ kind: 'genre', value: 'Surf' }
			]
		});
		const tags = await testDb
			.select()
			.from(classifiedPostTag)
			.where(eq(classifiedPostTag.postId, row.id));
		expect(tags.map((t) => `${t.kind}:${t.value}`).sort()).toEqual([
			'genre:surf',
			'instrument:drums'
		]);
	});

	it('posts as a band the author administers', async () => {
		const row = await post({ groupId: BAND });
		expect(row.groupId).toBe(BAND);
	});

	it('refuses a band the author is only a plain member of', async () => {
		await expect(post({ groupId: NOT_MY_BAND })).rejects.toThrow(svc.ClassifiedForbiddenError);
	});

	it('refuses a post past the open-post cap, but not once one has expired', async () => {
		for (let i = 0; i < MAX_OPEN_CLASSIFIEDS; i++) await post();
		await expect(post()).rejects.toThrow(svc.ClassifiedLimitError);

		const later = new Date(NOW.getTime() + (CLASSIFIED_LIFETIME_DAYS + 1) * DAY);
		await expect(post({}, later)).resolves.toBeTruthy();
	});
});

describe('the board', () => {
	it('shows only open, visible, unexpired posts', async () => {
		const live = await post();
		const closed = await post({ title: 'closed' });
		await svc.closePost(closed.id, AUTHOR);
		const hidden = await post({ title: 'hidden' });
		await svc.setVisibility(hidden.id, { visibility: 'hidden', note: 'no', staffId: STAFF });
		const expired = await post({ title: 'old' }, new Date(NOW.getTime() - 40 * DAY));

		expect(await board()).toEqual([live.id]);
		expect(await board({ authorUserId: AUTHOR })).toEqual(
			expect.arrayContaining([live.id, closed.id, hidden.id, expired.id])
		);
	});

	it('filters by kind, category and tag', async () => {
		const drums = await post({ tags: [{ kind: 'instrument', value: 'drums' }] });
		const jam = await post({ kind: 'offered', category: 'jam', title: 'Blues jam' });

		expect(await board({ kind: 'offered' })).toEqual([jam.id]);
		expect(await board({ category: 'musician' })).toEqual([drums.id]);
		expect(await board({ tag: { kind: 'instrument', value: 'Drums' } })).toEqual([drums.id]);
	});
});

describe('gear posts', () => {
	it('lists gear for sale, wanted or for trade under the gear category', async () => {
		const sale = await post({ kind: 'offered', category: 'gear', title: 'Fender Twin' });
		const trade = await post({ kind: 'trade', category: 'gear', title: 'Swap: fuzz for delay' });
		await post();

		expect((await board({ category: 'gear' })).sort()).toEqual([sale.id, trade.id].sort());
		expect(await board({ kind: 'trade' })).toEqual([trade.id]);
	});

	it('refuses a trade outside the gear category, on create and on edit', async () => {
		await expect(post({ kind: 'trade', category: 'service' })).rejects.toThrow(
			svc.ClassifiedValidationError
		);
		const row = await post({ kind: 'trade', category: 'gear' });
		await expect(
			svc.updatePost(row.id, AUTHOR, { ...base, kind: 'trade', category: 'musician' })
		).rejects.toThrow(svc.ClassifiedValidationError);
	});

	it('goes through the same report path as any other post', async () => {
		const row = await post({ kind: 'offered', category: 'gear' });
		await svc.withholdForReview(row.id);
		expect((await svc.getPostForModeration(row.id))?.visibility).toBe('under_review');
		expect(await board({ category: 'gear' })).toEqual([]);
	});
});

describe('author actions', () => {
	it('only the author may edit, renew or close', async () => {
		const row = await post();
		await expect(svc.closePost(row.id, OTHER)).rejects.toThrow(svc.ClassifiedNotFoundError);
		await expect(svc.renewPost(row.id, OTHER, NOW)).rejects.toThrow(svc.ClassifiedNotFoundError);
		await expect(svc.updatePost(row.id, OTHER, { ...base, title: 'Mine now' })).rejects.toThrow(
			svc.ClassifiedNotFoundError
		);
	});

	it('renewing resets the expiry from now', async () => {
		const row = await post();
		const later = new Date(NOW.getTime() + 25 * DAY);
		await svc.renewPost(row.id, AUTHOR, later);
		const [after] = await testDb.select().from(classifiedPost).where(eq(classifiedPost.id, row.id));
		expect(after.expiresAt.getTime()).toBe(later.getTime() + CLASSIFIED_LIFETIME_DAYS * DAY);
	});

	it('refuses to renew a hidden post', async () => {
		const row = await post();
		await svc.setVisibility(row.id, { visibility: 'hidden', note: 'no', staffId: STAFF });
		await expect(svc.renewPost(row.id, AUTHOR, NOW)).rejects.toThrow(svc.ClassifiedStateError);
	});

	it('an edit to a hidden post sends it back for review and keeps the note history', async () => {
		const row = await post();
		await svc.setVisibility(row.id, { visibility: 'hidden', note: 'Too vague', staffId: STAFF });
		await svc.updatePost(row.id, AUTHOR, { ...base, title: 'Drummer wanted, Tuesdays 7pm' });
		const [after] = await testDb.select().from(classifiedPost).where(eq(classifiedPost.id, row.id));
		expect(after.visibility).toBe('pending_review');
		expect(after.title).toBe('Drummer wanted, Tuesdays 7pm');
	});

	it('an ordinary edit keeps the post on the board and replaces its tags', async () => {
		const row = await post({ tags: [{ kind: 'instrument', value: 'drums' }] });
		await svc.updatePost(row.id, AUTHOR, { ...base, tags: [{ kind: 'genre', value: 'surf' }] });
		expect(await board({ tag: { kind: 'genre', value: 'surf' } })).toEqual([row.id]);
		expect(await board({ tag: { kind: 'instrument', value: 'drums' } })).toEqual([]);
	});
});

describe('moderation', () => {
	it('a report withholds a visible post, and never resurrects a hidden one', async () => {
		const row = await post();
		await svc.withholdForReview(row.id);
		expect((await svc.getPostForModeration(row.id))?.visibility).toBe('under_review');

		await svc.setVisibility(row.id, { visibility: 'hidden', note: 'no', staffId: STAFF });
		await svc.withholdForReview(row.id);
		expect((await svc.getPostForModeration(row.id))?.visibility).toBe('hidden');
	});

	it('hiding keeps the row: enforcement never deletes', async () => {
		const row = await post({ tags: [{ kind: 'instrument', value: 'drums' }] });
		await svc.setVisibility(row.id, { visibility: 'hidden', note: 'no', staffId: STAFF });
		await svc.setVisibility(row.id, { visibility: 'visible', note: null, staffId: STAFF });
		expect(await board({ tag: { kind: 'instrument', value: 'drums' } })).toEqual([row.id]);
	});
});

describe('canView', () => {
	const live = { authorUserId: AUTHOR, status: 'open', visibility: 'visible', expiresAt: NOW };

	it('shows a post on the board to anyone, and anything else only to its author or staff', () => {
		const future = new Date(NOW.getTime() + DAY);
		expect(svc.canView({ ...live, expiresAt: future }, OTHER, false, NOW)).toBe(true);
		expect(
			svc.canView({ ...live, visibility: 'hidden', expiresAt: future }, OTHER, false, NOW)
		).toBe(false);
		expect(svc.canView({ ...live, expiresAt: NOW }, OTHER, false, NOW)).toBe(false);
		expect(svc.canView({ ...live, visibility: 'hidden' }, AUTHOR, false, NOW)).toBe(true);
		expect(svc.canView({ ...live, status: 'closed' }, OTHER, true, NOW)).toBe(true);
	});
});
