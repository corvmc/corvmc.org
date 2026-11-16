import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

/**
 * The "door code ready" notice: owed once the lock has reported a booking's
 * code as synced, and never before. The sent-mark makes it once; this pins
 * what makes it owed.
 */

let rows: unknown[] = [];
let whereArg: SQL | undefined;

function chain(): any {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') return (resolve: (v: unknown[]) => void) => resolve(rows);
			if (prop === 'where')
				return (w: SQL) => {
					whereArg = w;
					return proxy;
				};
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('#lib/server/db/index.js', () => ({ db: { select: () => chain() } }));
vi.mock('#lib/server/inventory/loan-service.js', () => ({
	listLoansDueBetween: vi.fn(async () => [])
}));
vi.mock('#lib/server/volunteer/volunteer-signup-service.js', () => ({
	listSignupsStartingBetween: vi.fn(async () => []),
	listCompletionsAwaitingFeedback: vi.fn(async () => [])
}));

const owing = vi.hoisted(() => ({ ids: new Set<string>() }));
vi.mock('#lib/server/reservation/outstanding-fees.js', () => ({
	membersOwingFees: vi.fn(async (userIds: string[]) => {
		return new Set(userIds.filter((id) => owing.ids.has(id)));
	})
}));

const { reminders } = await import('./registry');

const NOW = new Date('2026-06-15T12:00:00Z');
const definition = () => reminders.find((r) => r.key === 'door_code_ready')!;

beforeEach(() => {
	rows = [];
	whereArg = undefined;
	owing.ids = new Set();
});

const synced = (id: string, userId: string) => ({
	id,
	lockCode: '482913',
	startsAt: new Date('2026-06-15T18:00:00Z'),
	endsAt: new Date('2026-06-15T20:00:00Z'),
	userId,
	userName: 'Robin',
	userEmail: `${userId}@example.com`
});

describe('door_code_ready', () => {
	it('is keyed per reservation, so a re-sync after a moved window does not send again', () => {
		expect(definition()).toMatchObject({
			subjectType: 'reservation',
			event: 'reservation.door_code_ready'
		});
	});

	it('carries the code and the booking window to the member who made it', async () => {
		rows = [
			{
				id: 'res-1',
				lockCode: '482913',
				startsAt: new Date('2026-06-15T02:00:00Z'),
				endsAt: new Date('2026-06-15T04:00:00Z'),
				userId: 'u-1',
				userName: 'Robin',
				userEmail: 'robin@example.com'
			}
		];

		const due = await definition().due(NOW);

		expect(due).toHaveLength(1);
		expect(due[0].subjectId).toBe('res-1');
		expect(due[0].payload).toMatchObject({
			reservationId: 'res-1',
			code: '482913',
			userId: 'u-1',
			userEmail: 'robin@example.com'
		});
	});

	it('asks only for confirmed codes the lock has synced, recently, for bookings not yet over', async () => {
		await definition().due(NOW);

		const { sql, params } = new SQLiteSyncDialect().sqlToQuery(whereArg!);
		expect(sql).toContain('"lock_synced_at" is not null');
		expect(sql).toContain('"lock_code" is not null');
		expect(sql).toContain('"status" = ?');
		expect(params).toContain('confirmed');
		expect(sql).toContain('"ends_at" > ?');
		// Bounded, so the first drain after deploy does not mail every code
		// already on the lock.
		expect(sql).toContain('"lock_synced_at" >= ?');
	});

	it('is withheld while the member owes a fee, and owed again once it is paid (#2859)', async () => {
		rows = [synced('res-owing', 'u-owing'), synced('res-clear', 'u-clear')];
		owing.ids = new Set(['u-owing']);
		expect((await definition().due(NOW)).map((d) => d.subjectId)).toEqual(['res-clear']);

		owing.ids = new Set();
		expect((await definition().due(NOW)).map((d) => d.subjectId)).toEqual([
			'res-owing',
			'res-clear'
		]);
	});

	it('stays owed for a booking starting within a day, however long ago the code synced', async () => {
		await definition().due(NOW);
		const { sql } = new SQLiteSyncDialect().sqlToQuery(whereArg!);
		expect(sql).toContain(
			'("reservation"."lock_synced_at" >= ?) or ("reservation"."starts_at" < ?)'
		);
	});
});
