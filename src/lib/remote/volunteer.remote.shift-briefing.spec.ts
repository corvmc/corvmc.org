import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';

/**
 * The role's briefing on the volunteer's shift page (#2728), through the
 * remote, against a real SQLite: a draft or an article above the member's
 * tier is left out rather than linked to a page they cannot open.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb, getRowCount: () => 0 }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('#lib/server/finance/subscription-service.js', () => ({
	isSustainingMember: async () => false,
	isSustainingMemberSql: () => sql`0`
}));

vi.mock('$app/server', () => {
	const mark = <F>(fn: F, type: string) => Object.assign(fn as object, { __: { type } }) as F;
	const call = (run: () => Promise<unknown>) => ({
		then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => run().then(ok, fail),
		refresh: async () => {}
	});
	return {
		getRequestEvent: () => ({ locals: { user: { id: 'nia' } }, url: new URL('http://x/') }),
		query: (...args: unknown[]) => {
			const handler = args.at(-1) as (raw: unknown) => Promise<unknown>;
			return mark((raw: unknown) => call(() => handler(raw)), 'query');
		},
		form: (...args: unknown[]) => mark(args.at(-1), 'form'),
		command: (...args: unknown[]) => mark(args.at(-1), 'command')
	};
});

vi.mock('#lib/server/authorization.js', () => ({
	requireUser: () => ({ id: 'nia' }),
	can: async () => false,
	getUserRoles: async () => [],
	committeeCapabilitiesFor: async () => [],
	positionsFor: async () => [],
	capabilitySet: () => [],
	// The crew list on the page selects member refs, which carry a position.
	topPositionFor: () => sql`null`,
	requireCapability: async () => {
		throw new Error('not reached');
	}
}));

const remote = (await import('./volunteer.remote')) as unknown as {
	getMyShift: (id: string) => PromiseLike<{ briefing: { id: string; slug: string } | null }>;
};

function linkBriefing(articleId: string | null) {
	sqlite
		.prepare(`update volunteer_role set briefing_article_id = ? where id = 'door'`)
		.run(articleId);
}

beforeEach(() => {
	for (const t of [
		'volunteer_signup',
		'volunteer_shift',
		'work_order',
		'volunteer_role',
		'help_articles',
		'help_categories',
		'"user"'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	sqlite.exec(`
		insert into "user" (id, name, email) values ('nia', 'Nia', 'nia@example.com');
		insert into help_categories (id, name, slug) values ('c', 'Volunteering', 'volunteering');
		insert into help_articles (id, category_id, title, slug, content, min_role, published) values
			('art-door', 'c', 'Door policy', 'door-policy', 'x', 'member', 1),
			('art-draft', 'c', 'Door policy draft', 'door-policy-draft', 'x', 'member', 0),
			('art-staff', 'c', 'Door cash', 'door-cash', 'x', 'staff', 1);
		insert into volunteer_role (id, name) values ('door', 'Door');
		insert into work_order (id, volunteer_role_id) values ('wo', 'door');
		insert into volunteer_shift (id, work_order_id, starts_at, ends_at, capacity)
			values ('sh', 'wo', 2000000000, 2000003600, 2);
		insert into volunteer_signup (id, shift_id, user_id, status) values ('s1', 'sh', 'nia', 'confirmed');
	`);
});

describe('getMyShift briefing', () => {
	it('links the published article the role names', async () => {
		linkBriefing('art-door');
		expect((await remote.getMyShift('s1')).briefing).toMatchObject({ slug: 'door-policy' });
	});

	it.each([['art-draft'], ['art-staff'], [null]])('has none for %s', async (articleId) => {
		linkBriefing(articleId);
		expect((await remote.getMyShift('s1')).briefing).toBeNull();
	});
});
