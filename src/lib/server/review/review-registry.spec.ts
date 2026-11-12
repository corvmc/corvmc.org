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
const { surfaces } = await import('#lib/config.js');

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

		insert into content_flag (id, entity_type, entity_id, reason, status, created_at) values
			('f1', 'band_profile', 'b1', 'spam', 'resolved', ${T - 3 * DAY}),
			('f2', 'band_profile', 'b2', 'spam', 'resolved', ${T - 3 * DAY}),
			('f-open', 'event', 'l-live', 'spam', 'pending', ${T - 3 * DAY}),
			('f-gone', 'band_profile', 'nobody', 'Rude bio', 'pending', ${T - 3 * DAY}),
			('f-ad', 'classified_post', 'p-held', 'spam', 'pending', ${T - 3 * DAY});
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

		insert into classified_post (id, author_user_id, kind, category, title, body, visibility,
			visibility_changed_at, expires_at, created_at) values
			('p-held', 'ana', 'offered', 'gear', 'Amp for sale', 'b', 'pending_review', ${T - 5 * DAY}, ${T + 30 * DAY}, ${T - 6 * DAY}),
			('p-old', 'ana', 'offered', 'gear', 'Held before the column', 'b', 'pending_review', null, ${T + 30 * DAY}, ${T - 6 * DAY}),
			('p-live', 'ana', 'offered', 'gear', 'On the board', 'b', 'visible', null, ${T + 30 * DAY}, ${T - 6 * DAY});

		insert into equipment_category (id, name, pricing_tier) values ('amps', 'Amps', 'major');
		insert into inventory_item (id, name, category_id, kind) values ('item', 'Bass amp', 'amps', 'serialized');
		insert into inventory_asset (id, item_id, condition) values ('unit', 'item', 'good');
		insert into work_request (id, asset_id, location, reported_by_user_id, note, status, work_order_id, created_at) values
			('w-unit', 'unit', null, 'bo', 'Crackles', 'pending', null, ${T - 3 * DAY}),
			('w-room', null, 'Bathroom', 'bo', 'Running toilet', 'pending', null, ${T - 3 * DAY}),
			('w-sent', 'unit', null, 'bo', 'Crackles again', 'pending', 'wo', ${T - 3 * DAY}),
			('w-done', 'unit', null, 'bo', 'Fixed', 'resolved', null, ${T - 3 * DAY});

		insert into "group" (id, name, slug, kind) values
			('club', 'Real Book Club', 'real-book', 'club'),
			('cttee', 'Booking', 'booking', 'committee'),
			('band', 'The Owls', 'owls', 'band');
		insert into group_application (id, user_id, created_at) values
			('app-ana', 'ana', ${T - 2 * DAY}), ('app-gone', 'bo', ${T - 2 * DAY}), ('app-bo', 'bo', ${T - 2 * DAY});
		update group_application set withdrawn_at = ${T} where id = 'app-gone';
		insert into group_application_choice (id, application_id, group_id, status) values
			('g-club', 'app-ana', 'club', 'submitted'),
			('g-cttee', 'app-ana', 'cttee', 'contacted'),
			('g-band', 'app-ana', 'band', 'submitted'),
			('g-withdrawn', 'app-gone', 'club', 'submitted'),
			('g-decided', 'app-bo', 'cttee', 'accepted');

		insert into market_vendor (id, event_id, business_name, offering, status, created_at) values
			('v-applied', 'l-live', 'Riverside Records', 'Vinyl', 'applied', ${T - DAY}),
			('v-accepted', 'l-live', 'Taken', 'Vinyl', 'accepted', ${T - DAY});

		insert into volunteer_profile (id, user_id, first_name, last_name, is_adult, status, created_at) values
			('vp-minor', 'ana', 'Ana', 'Young', 0, 'blocked', ${T - DAY}),
			('vp-adult', 'bo', 'Bo', 'Grown', 1, 'active', ${T - DAY});
	`);
});

const WAITING: Record<string, string[]> = {
	suggestion_moderation: ['s-mod', 's-review'],
	suggestion_answer: ['s-answer'],
	suggestion_edit: ['e-pending'],
	listing: ['l-pending'],
	classified: ['p-held', 'p-old'],
	resource_tip: ['r-tip'],
	// The classified report waits only while classifieds are on.
	flag: ['f-gone', 'f-open'],
	appeal: ['a-open'],
	problem: ['w-room', 'w-unit'],
	group_application: ['g-club', 'g-cttee'],
	market_vendor: ['v-applied'],
	hour_log: ['h-pending'],
	shift_claim: ['c-ahead'],
	minor_volunteer: ['ana']
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
		expect(reviewKindsFor(['committee.reviewApplications']).map((d) => d.kind)).toEqual([
			'group_application'
		]);
		expect(reviewKindsFor(['volunteer.manageRoster']).map((d) => d.kind)).toEqual([
			'shift_claim',
			'minor_volunteer'
		]);
	});

	it('offers classifieds, and counts their reports, only while the surface is on', async () => {
		expect(reviewKindsFor(['listing.review']).map((d) => d.kind)).toEqual(['listing']);
		surfaces.classifieds = true;
		try {
			expect(reviewKindsFor(['listing.review']).map((d) => d.kind)).toEqual([
				'listing',
				'classified'
			]);
			expect(await reviewRegistry.flag.count(NOW)).toBe(3);
		} finally {
			surfaces.classifieds = false;
		}
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

	it('links each row to the record its decision is made on', async () => {
		const page = await listReviewFeed(everything, { limit: 100 }, NOW);
		const refs = Object.fromEntries(page.items.map((i) => [i.id, i.ref]));
		expect(refs['group_application:g-club']).toMatchObject({ groupId: 'club' });
		expect(refs['market_vendor:v-applied']).toMatchObject({ eventId: 'l-live' });
		expect(refs['problem:w-room']).toMatchObject({ type: 'work_request', id: 'w-room' });
		expect(refs['minor_volunteer:ana']).toMatchObject({ type: 'volunteer', id: 'ana' });
	});

	it('names what a report is about, or its reason when the target is gone', async () => {
		const page = await listReviewFeed(everything, { kind: 'flag', limit: 10 }, NOW);
		expect(Object.fromEntries(page.items.map((i) => [i.id, i.summary]))).toEqual({
			'flag:f-open': 'Live show',
			'flag:f-gone': 'Rude bio'
		});
	});

	it('names the submitter, or the email a public tip came from', async () => {
		const page = await listReviewFeed(['localResource.manage'], { limit: 10 }, NOW);
		expect(page.items[0]).toMatchObject({ actorName: 'tip@example.dev', summary: 'Guitar repair' });
	});
});
