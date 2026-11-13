import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A role's briefing article reaches the member on the shift and at the door
 * (#2728), against a real SQLite: which signups count is a WHERE clause.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/event-bus/event-bus.js', () => ({ domainEvents: { emit: vi.fn() } }));

const { listBriefingsForEvents, getSignupForUser } = await import('./volunteer-signup-service');

const T0 = 2_000_000_000;
const exec = (q: string) => sqlite.exec(q);

beforeEach(() => {
	for (const t of ['volunteer_signup', 'volunteer_shift', 'work_order', 'volunteer_role']) {
		exec(`delete from ${t}`);
	}
	exec(`insert into volunteer_role (id, name, briefing_article_id) values
		('door', 'Door', 'art-door'), ('bar', 'Bar', 'art-bar'), ('stage', 'Stage', null)`);
	exec(`insert into work_order (id, volunteer_role_id, event_id, cancelled_at) values
		('wo-door', 'door', 'evt', null), ('wo-bar', 'bar', 'evt', ${T0}),
		('wo-stage', 'stage', 'evt', null), ('wo-other', 'door', 'evt-2', null)`);
	exec(`insert into volunteer_shift (id, work_order_id, starts_at, ends_at, capacity) values
		('sh-door', 'wo-door', ${T0}, ${T0 + 3600}, 2), ('sh-bar', 'wo-bar', ${T0}, ${T0 + 3600}, 2),
		('sh-stage', 'wo-stage', ${T0}, ${T0 + 3600}, 2), ('sh-other', 'wo-other', ${T0}, ${T0 + 3600}, 2)`);
});

describe('listBriefingsForEvents', () => {
	it('lists the briefing of each live role the member is on for the show', async () => {
		exec(`insert into volunteer_signup (id, shift_id, user_id, status) values
			('s-door', 'sh-door', 'u1', 'confirmed'), ('s-bar', 'sh-bar', 'u1', 'confirmed'),
			('s-stage', 'sh-stage', 'u1', 'confirmed'), ('s-other', 'sh-other', 'u1', 'claimed')`);

		expect(await listBriefingsForEvents('u1', ['evt'])).toEqual([
			{ eventId: 'evt', roleName: 'Door', articleId: 'art-door' }
		]);
	});

	it('leaves out a dropped signup and somebody else’s', async () => {
		exec(`insert into volunteer_signup (id, shift_id, user_id, status) values
			('s-gone', 'sh-door', 'u1', 'cancelled'), ('s-them', 'sh-door', 'u2', 'confirmed')`);

		expect(await listBriefingsForEvents('u1', ['evt'])).toEqual([]);
	});

	it('asks nothing for no shows', async () => {
		expect(await listBriefingsForEvents('u1', [])).toEqual([]);
	});
});

describe('getSignupForUser', () => {
	it("carries the role's briefing article", async () => {
		exec(`insert into volunteer_signup (id, shift_id, user_id, status) values
			('s-door', 'sh-door', 'u1', 'confirmed')`);

		expect((await getSignupForUser('s-door', 'u1'))?.briefingArticleId).toBe('art-door');
	});
});
