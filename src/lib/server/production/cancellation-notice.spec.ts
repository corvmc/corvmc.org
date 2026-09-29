import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * #1675: cancelling a show tells the Production committee on it, naming who
 * cancelled. Against a real SQLite replayed from the migrations, so the recipient
 * query is the one that runs in production.
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

const { transitionProduction, cancelProductionsForEvent } = await import('./production-service');

const SHOW = 'proj-show';
const T0 = 1_790_000_000;

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

const cancellations = () =>
	emit.mock.calls.filter(([name]) => name === 'production.cancelled').map(([, p]) => p);

beforeEach(() => {
	emit.mockClear();
	for (const t of [
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
	person('u-book', 'Ada Booker');
	person('u-prod', 'Cy Crew');
	person('u-prod2', 'Di Desk');
	person('u-lapsed', 'Ed Lapsed');
	person('u-gone', 'Flo Gone', true);
	committee('g-book', 'booking-committee');
	committee('g-prod', 'production-committee');
	committee('g-old', 'old-production', true);
	seat('g-book', 'u-book');
	seat('g-prod', 'u-prod');
	seat('g-prod', 'u-prod2');
	seat('g-prod', 'u-lapsed', 'inactive');
	seat('g-prod', 'u-gone');
	seat('g-old', 'u-lapsed');

	exec(`insert into project (id, name, kind) values ('${SHOW}', 'Friday', 'production')`);
	exec(`insert into project_committee (project_id, group_id, role) values
		('${SHOW}', 'g-book', 'booking'), ('${SHOW}', 'g-prod', 'production'),
		('${SHOW}', 'g-old', 'production')`);
	exec(`insert into production (id, project_id, status) values ('prod-1', '${SHOW}', 'confirmed')`);
	exec(`insert into event_listing (id, title, starts_at, ends_at, created_by_user_id, source, kind, production_id, project_id)
		values ('evt-1', 'Friday Night Fuzz', ${T0}, ${T0 + 7200}, 'u-book', 'cmc', 'show', 'prod-1', '${SHOW}')`);
});

describe('cancelling a show tells Production', () => {
	it('names the show, who cancelled it, and each live Production seat', async () => {
		await transitionProduction('prod-1', 'cancelled', 'u-book');

		expect(cancellations()).toEqual([
			{
				productionId: 'prod-1',
				eventId: 'evt-1',
				eventTitle: 'Friday Night Fuzz',
				startsAt: new Date(T0 * 1000).toISOString(),
				cancelledByName: 'Ada Booker',
				recipients: [
					expect.objectContaining({ userId: 'u-prod', committeeSlug: 'production-committee' }),
					expect.objectContaining({ userId: 'u-prod2', committeeSlug: 'production-committee' })
				]
			}
		]);
	});

	it('does not tell a Production member about their own cancellation', async () => {
		await transitionProduction('prod-1', 'cancelled', 'u-prod');

		const [notice] = cancellations() as Array<{ recipients: { userId: string }[] }>;
		expect(notice.recipients.map((r) => r.userId)).toEqual(['u-prod2']);
	});

	it('says nothing for a move that is not a cancellation', async () => {
		await transitionProduction('prod-1', 'completed', 'u-prod');
		expect(cancellations()).toEqual([]);
	});

	it('says nothing when the cancellation was refused', async () => {
		exec(`update production set status = 'closed' where id = 'prod-1'`);
		await expect(transitionProduction('prod-1', 'cancelled', 'u-book')).rejects.toThrow();
		expect(cancellations()).toEqual([]);
	});

	it('tells Production when the listing is cancelled and takes the show with it', async () => {
		await cancelProductionsForEvent('evt-1', 'u-book');

		const [notice] = cancellations() as Array<{ cancelledByName: string; recipients: unknown[] }>;
		expect(notice.cancelledByName).toBe('Ada Booker');
		expect(notice.recipients).toHaveLength(2);
	});

	it('says nothing when the listing is cancelled after the show happened', async () => {
		exec(`update production set status = 'completed' where id = 'prod-1'`);
		await cancelProductionsForEvent('evt-1', 'u-book');
		expect(cancellations()).toEqual([]);
	});
});
