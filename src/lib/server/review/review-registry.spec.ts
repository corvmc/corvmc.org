import { describe, it, expect, beforeAll, vi } from 'vitest';

/**
 * Every kind's `list` and `count` against a real SQLite: one row waiting and
 * one decided per kind, so a predicate that drifts between the two shows here.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));

const { reviewRegistry, countReviewFeed, listReviewFeed, reviewKindsFor } =
	await import('./review-registry');
const { reviewKinds } = await import('#lib/types/review.js');

const NOW = new Date('2026-11-12T12:00:00Z');
const T = Math.floor(NOW.getTime() / 1000);
const DAY = 86_400;

beforeAll(() => {
	sqlite.exec(`
		insert into user (id, name, email) values ('ana', 'Ana', 'ana@example.dev'), ('bo', 'Bo', 'bo@example.dev');

		insert into suggestion (id, author_user_id, title, body, visibility, status, created_at) values
			('s-mod', 'ana', 'Moderate me', 'b', 'pending_review', 'open', ${T - 9 * DAY}),
			('s-review', 'ana', 'Under review', 'b', 'under_review', 'open', ${T - 8 * DAY}),
			('s-answer', 'ana', 'Answer me', 'b', 'visible', 'open', ${T - 7 * DAY}),
			('s-answered', 'ana', 'Answered', 'b', 'visible', 'open', ${T - 7 * DAY}),
			('s-closed', 'ana', 'Closed', 'b', 'visible', 'declined', ${T - 7 * DAY});
		update suggestion set response_body = 'Done' where id = 's-answered';

		insert into suggestion_edit (id, suggestion_id, requested_by_user_id, proposed_title, proposed_body,
			proposed_category, original_title, original_body, original_category, status, created_at) values
			('e-pending', 's-answer', 'ana', 't', 'b', 'other', 't', 'b', 'other', 'pending', ${T - 6 * DAY}),
			('e-done', 's-answer', 'ana', 't', 'b', 'other', 't', 'b', 'other', 'approved', ${T - 6 * DAY});

		insert into event_listing (id, title, starts_at, created_by_user_id, status, source, created_at) values
			('l-pending', 'Basement show', ${T + 9 * DAY}, 'ana', 'pending_review', 'community', ${T - 5 * DAY}),
			('l-live', 'Live show', ${T + 9 * DAY}, 'ana', 'published', 'community', ${T - 5 * DAY});

		insert into local_resource_category (id, name) values ('cat', 'Repair');
		insert into local_resource (id, category_id, name, status, submitter_email, created_at) values
			('r-tip', 'cat', 'Guitar repair', 'pending', 'tip@example.dev', ${T - 4 * DAY}),
			('r-gone', 'cat', 'Deleted tip', 'pending', null, ${T - 4 * DAY}),
			('r-live', 'cat', 'Published', 'published', null, ${T - 4 * DAY});
		update local_resource set deleted_at = ${T} where id = 'r-gone';

		insert into content_flag (id, entity_type, entity_id, reason) values
			('f1', 'band', 'b1', 'spam'), ('f2', 'band', 'b2', 'spam');
		insert into moderation_appeal (id, flag_id, appellant_user_id, body, created_at) values
			('a-open', 'f1', 'ana', 'Please look again', ${T - 3 * DAY}),
			('a-done', 'f2', 'ana', 'Decided', ${T - 3 * DAY});
		update moderation_appeal set decided_at = ${T} where id = 'a-done';

		insert into volunteer_role (id, name) values ('door', 'Door');
		insert into volunteer_hour_log (id, user_id, volunteer_role_id, worked_on, minutes, description, status, created_at) values
			('h-pending', 'ana', 'door', ${T - 2 * DAY}, 120, 'Door', 'pending', ${T - 2 * DAY}),
			('h-done', 'ana', 'door', ${T - 2 * DAY}, 120, 'Door', 'approved', ${T - 2 * DAY});

		insert into work_order (id, volunteer_role_id, title) values ('wo', 'door', 'Door');
		insert into volunteer_shift (id, work_order_id, starts_at, ends_at) values
			('ahead', 'wo', ${T + DAY}, ${T + DAY + 3600}),
			('past', 'wo', ${T - DAY}, ${T - DAY + 3600});
		insert into volunteer_signup (id, shift_id, user_id, status, claimed_at, created_at) values
			('c-ahead', 'ahead', 'ana', 'claimed', ${T - DAY}, ${T - DAY}),
			('c-past', 'past', 'ana', 'claimed', ${T - 2 * DAY}, ${T - 2 * DAY}),
			('c-confirmed', 'ahead', 'bo', 'confirmed', ${T - DAY}, ${T - DAY});
	`);
});

const WAITING: Record<string, string[]> = {
	suggestion_moderation: ['s-mod', 's-review'],
	suggestion_answer: ['s-answer'],
	suggestion_edit: ['e-pending'],
	listing: ['l-pending'],
	resource_tip: ['r-tip'],
	appeal: ['a-open'],
	hour_log: ['h-pending'],
	shift_claim: ['c-ahead']
};

describe('the review registry', () => {
	it('has a fixture for every kind', () => {
		expect(Object.keys(WAITING).sort()).toEqual([...reviewKinds].sort());
	});

	for (const kind of reviewKinds) {
		it(`lists and counts the same ${kind} rows`, async () => {
			const def = reviewRegistry[kind];
			const rows = await def.list({ limit: 100, now: NOW });
			expect(rows.map((r) => r.id).sort()).toEqual(WAITING[kind].map((id) => `${kind}:${id}`));
			expect(await def.count(NOW)).toBe(rows.length);
		});
	}

	it('offers a viewer only the kinds their capabilities allow', () => {
		expect(reviewKindsFor(['volunteer.reviewHours']).map((d) => d.kind)).toEqual(['hour_log']);
		expect(reviewKindsFor(['payment.read'])).toEqual([]);
	});
});

describe('the feed', () => {
	const everything = [...new Set(Object.values(reviewRegistry).map((d) => d.capability as string))];

	it('merges every kind oldest first, and its counts agree with it', async () => {
		const page = await listReviewFeed(everything, { limit: 100 }, NOW);
		const times = page.items.map((i) => i.at.getTime());
		expect(times).toEqual([...times].sort((a, b) => a - b));
		const counts = await countReviewFeed(everything, NOW);
		expect(counts.total).toBe(page.items.length);
		expect(page.hasMore).toBe(false);
	});

	it('pages with an exact hasMore', async () => {
		const page = await listReviewFeed(everything, { limit: 3 }, NOW);
		expect(page.items.map((i) => i.id)).toEqual([
			'suggestion_moderation:s-mod',
			'suggestion_moderation:s-review',
			'suggestion_answer:s-answer'
		]);
		expect(page.hasMore).toBe(true);
	});

	it('narrows to one kind', async () => {
		const page = await listReviewFeed(everything, { kind: 'appeal', limit: 10 }, NOW);
		expect(page.items.map((i) => [i.id, i.ref.type, i.ref.id])).toEqual([
			['appeal:a-open', 'flag', 'f1']
		]);
	});

	it('names the submitter, or the email a public tip came from', async () => {
		const page = await listReviewFeed(['localResource.manage'], { limit: 10 }, NOW);
		expect(page.items[0]).toMatchObject({ actorName: 'tip@example.dev', summary: 'Guitar repair' });
	});
});
