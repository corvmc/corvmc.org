import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '#lib/server/db/test-factory.js';

/**
 * The staff events list's date filter, against a real SQLite: the "to" day
 * includes its last minute and stops at the next midnight (#3067).
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});
vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

vi.mock('#lib/server/authorization.js', () => ({
	requireCapability: vi.fn(async () => mockUser({ id: 'staff-1' })),
	requireUser: vi.fn(() => mockUser({ id: 'staff-1' }))
}));

vi.mock('#lib/server/feature-flags.js', () => ({
	isFeatureEnabled: vi.fn(async () => true),
	requireFeature: vi.fn(async () => undefined)
}));

vi.mock('$app/server', () => {
	const mark = (type: string) => (handler: (...a: any[]) => any) =>
		Object.assign(handler, { __: { type }, for: () => handler });
	const pick = (args: unknown[]) => (typeof args[0] === 'function' ? args[0] : args[1]) as any;
	return {
		getRequestEvent: () => ({
			locals: { user: mockUser({ id: 'staff-1' }) },
			url: new URL('http://localhost/staff/events'),
			request: { headers: new Headers() }
		}),
		command: (...args: unknown[]) => mark('command')(pick(args)),
		form: (...args: unknown[]) => mark('form')(pick(args)),
		query: (...args: unknown[]) => mark('query')(pick(args))
	};
});

const { getStaffEvents } = (await import('./events.remote')) as any;
const { eventListing } = await import('#lib/server/db/schema/event.js');

const HOUR = 3_600_000;
const listing = (id: string, startsAt: Date) => ({
	id,
	title: `Show ${id}`,
	startsAt,
	endsAt: new Date(startsAt.getTime() + 2 * HOUR),
	status: 'published' as const,
	source: 'cmc' as const,
	createdByUserId: 'user-1'
});

beforeEach(async () => {
	sqlite.exec('delete from event_listing');
	await testDb.insert(eventListing).values([
		listing('first-minute', new Date('2026-09-30T07:00:00Z')), // 00:00 PDT Sep 30
		listing('last-minute', new Date('2026-10-01T06:59:30Z')), // 23:59:30 PDT Sep 30
		listing('next-midnight', new Date('2026-10-01T07:00:00Z')) // 00:00 PDT Oct 1
	]);
});

describe('getStaffEvents date range', () => {
	it('keeps a show at 23:59:30 on the "to" day and stops at the next midnight', async () => {
		const { rows } = await getStaffEvents({ dateFrom: '2026-09-30', dateTo: '2026-09-30' });
		expect(rows.map((r: { id: string }) => r.id).sort()).toEqual(['first-minute', 'last-minute']);
	});
});
