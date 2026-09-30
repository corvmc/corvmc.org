import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * #1709: cancelling a show calls off its committees' open deliverables and
 * tells every committee that had one, naming who cancelled and what was called
 * off. It replaced #1675's rule of telling the committees taking part as
 * `'production'`. Against a real SQLite replayed from the migrations.
 */
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

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
vi.mock('./run-of-show-service', () => ({ recomputeSetTimes: async () => undefined }));
vi.mock('$lib/server/finance/production-expense-entries', () => ({
	postProductionExpenses: async () => undefined
}));
const emit = vi.fn(async (_name: string, _payload: unknown) => undefined);
vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: { emit: (name: string, payload: unknown) => emit(name, payload) }
}));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));
vi.mock('$lib/server/volunteer/volunteer-signup-service', () => ({
	notifySignupsOfCancellation: async () => undefined
}));

const { transitionProduction, cancelProductionsForEvent } = await import('./production-service');

const SHOW = 'proj-show';
const T0 = 1_890_000_000;

function exec(sql: string) {
	sqlite.exec(sql);
}

function person(id: string, name: string, deleted = false) {
	exec(`insert into user (id, name, email, email_verified, deleted_at)
		values ('${id}', '${name}', '${id}@x.test', 0, ${deleted ? T0 : 'null'})`);
}

function committee(id: string, slug: string, deleted = false) {
	exec(`insert into "group" (id, name, slug, kind, deleted_at)
		values ('${id}', '${id}', '${slug}', 'committee', ${deleted ? T0 : 'null'})`);
}

function seat(groupId: string, userId: string, status = 'active') {
	exec(`insert into group_member (id, group_id, user_id, role, status)
		values ('${groupId}-${userId}', '${groupId}', '${userId}', 'member', '${status}')`);
}

function item(id: string, groupId: string | null, title: string, doneWhen: string | null = null) {
	exec(`insert into work_order (id, volunteer_role_id, event_id, group_id, title, done_when, due_at)
		values ('${id}', 'r', 'evt-1', ${groupId ? `'${groupId}'` : 'null'}, '${title}',
			${doneWhen ? `'${doneWhen}'` : 'null'}, ${T0 - 86_400})`);
}

const cancellations = () =>
	emit.mock.calls.filter(([name]) => name === 'production.cancelled').map(([, p]) => p) as Array<{
		cancelledByName: string | null;
		recipients: Array<{ userId: string; committeeSlug: string; items: string[] }>;
	}>;

const cancelledIds = () =>
	(
		sqlite
			.prepare(`select id from work_order where cancelled_at is not null order by id`)
			.all() as { id: string }[]
	).map((r) => r.id);

beforeEach(() => {
	emit.mockClear();
	for (const t of [
		'work_task',
		'work_order',
		'event_listing',
		'production',
		'project_committee',
		'project',
		'group_member',
		'"group"',
		'user'
	]) {
		exec(`delete from ${t}`);
	}
	exec(`insert or ignore into volunteer_role (id, name) values ('r', 'Spec Role')`);
	person('u-book', 'Ada Booker');
	person('u-prod', 'Cy Crew');
	person('u-prod2', 'Di Desk');
	person('u-lapsed', 'Ed Lapsed');
	person('u-gone', 'Flo Gone', true);
	person('u-art', 'Gil Art');
	committee('g-book', 'booking-committee');
	committee('g-prod', 'production-committee');
	committee('g-art', 'art-and-merchandise-committee');
	committee('g-comms', 'communications-committee');
	seat('g-book', 'u-book');
	seat('g-prod', 'u-prod');
	seat('g-prod', 'u-prod2');
	seat('g-prod', 'u-lapsed', 'inactive');
	seat('g-prod', 'u-gone');
	seat('g-art', 'u-art');
	seat('g-art', 'u-prod');
	seat('g-comms', 'u-book');

	exec(`insert into project (id, name, kind) values ('${SHOW}', 'Friday', 'production')`);
	exec(`insert into project_committee (project_id, group_id, role) values
		('${SHOW}', 'g-book', 'booking'), ('${SHOW}', 'g-prod', 'production')`);
	exec(`insert into production (id, project_id, status) values ('prod-1', '${SHOW}', 'confirmed')`);
	exec(`insert into event_listing (id, title, starts_at, ends_at, created_by_user_id, source, kind, production_id, project_id, status)
		values ('evt-1', 'Friday Night Fuzz', ${T0}, ${T0 + 7200}, 'u-book', 'cmc', 'show', 'prod-1', '${SHOW}', 'published')`);

	item('wo-lineup', 'g-book', 'Lineup confirmed', 'production_confirmed');
	item('wo-promo', 'g-comms', 'Announced', 'event_published');
	item('wo-advance', 'g-prod', 'Advance with the acts');
	item('wo-poster', 'g-art', 'Poster art made', 'poster_set');
	item('wo-crew', null, 'Door');
});

describe('cancelling a show', () => {
	it('tells each committee with an open item what was called off, one notice per person', async () => {
		await transitionProduction('prod-1', 'cancelled', 'u-book');

		const [notice] = cancellations();
		expect(notice.cancelledByName).toBe('Ada Booker');
		expect(
			notice.recipients
				.map((r) => [r.userId, r.items] as const)
				.sort(([a], [b]) => a.localeCompare(b))
		).toEqual([
			['u-art', ['Poster art made']],
			['u-prod', ['Advance with the acts', 'Poster art made']],
			['u-prod2', ['Advance with the acts']]
		]);
		expect(cancellations()).toHaveLength(1);
	});

	it('leaves a finished item alone, even one that only held while the show was on', async () => {
		await transitionProduction('prod-1', 'cancelled', 'u-art');
		// The lineup was confirmed and the listing published: both were done. The
		// crew shift goes through #1705's cascade, as it did before.
		expect(cancelledIds()).toEqual(['wo-advance', 'wo-crew', 'wo-poster']);
		const recipients = cancellations()[0].recipients.map((r) => r.userId);
		expect(recipients).not.toContain('u-book');
	});

	it('records who cancelled the items, and never tells them', async () => {
		await transitionProduction('prod-1', 'cancelled', 'u-prod');
		const by = sqlite
			.prepare(`select distinct cancelled_by_user_id as b from work_order where id = 'wo-advance'`)
			.all();
		expect(by).toEqual([{ b: 'u-prod' }]);
		expect(
			cancellations()[0]
				.recipients.map((r) => r.userId)
				.sort()
		).toEqual(['u-art', 'u-prod2']);
	});

	it('says nothing when no committee has anything open', async () => {
		exec(`update work_order set resolved_at = ${T0} where group_id is not null`);
		await transitionProduction('prod-1', 'cancelled', 'u-book');
		expect(cancellations()).toEqual([]);
	});

	it('says nothing for a move that is not a cancellation, or one that was refused', async () => {
		await transitionProduction('prod-1', 'completed', 'u-prod');
		exec(`update production set status = 'closed'`);
		await expect(transitionProduction('prod-1', 'cancelled', 'u-book')).rejects.toThrow();
		expect(cancellations()).toEqual([]);
		expect(cancelledIds()).toEqual([]);
	});

	it('counts a listing cancel, reading the items as they stood before it', async () => {
		// As event-service.cancel does: the listing is cancelled first.
		const { openDeliverablesOnProductions } = await import('./cancellation-notice');
		const before = await openDeliverablesOnProductions(['prod-1']);
		exec(`update event_listing set status = 'cancelled'`);
		await cancelProductionsForEvent('evt-1', 'u-book', before);

		expect(cancelledIds()).toEqual(['wo-advance', 'wo-poster']);
		expect(cancellations()[0].recipients).toHaveLength(3);
	});
});
