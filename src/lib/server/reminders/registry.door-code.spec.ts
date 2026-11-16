import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';

/**
 * The "door code ready" notice (#2120): owed a day before a confirmed booking
 * starts, and sending it claims the booking's pool code. The sent-mark makes
 * it once; this pins what makes it owed and what holds it back.
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

const standing = vi.hoisted(() => ({ ids: new Set<string>() }));
vi.mock('#lib/server/lock/member-code-service.js', () => ({
	membersWithStandingCodes: vi.fn(async (userIds: string[]) => {
		return new Set(userIds.filter((id) => standing.ids.has(id)));
	})
}));

const { reminders } = await import('./registry');

const NOW = new Date('2026-06-15T12:00:00Z');
const definition = () => reminders.find((r) => r.key === 'door_code_ready')!;

beforeEach(() => {
	rows = [];
	whereArg = undefined;
	owing.ids = new Set();
	standing.ids = new Set();
});

const booking = (id: string, userId: string) => ({
	id,
	startsAt: new Date('2026-06-15T18:00:00Z'),
	endsAt: new Date('2026-06-15T20:00:00Z'),
	userId,
	userName: 'Robin',
	userEmail: `${userId}@example.com`
});

describe('door_code_ready', () => {
	it('is keyed per reservation, so a moved booking is not sent a second code', () => {
		expect(definition()).toMatchObject({
			subjectType: 'reservation',
			event: 'reservation.door_code_ready'
		});
	});

	// The code is claimed by the listener when the notice goes out, not here.
	it('carries the booking window to the member who made it, and no code', async () => {
		rows = [booking('res-1', 'u-1')];

		const due = await definition().due(NOW);

		expect(due).toHaveLength(1);
		expect(due[0].subjectId).toBe('res-1');
		expect(due[0].payload).toMatchObject({
			reservationId: 'res-1',
			userId: 'u-1',
			userEmail: 'u-1@example.com'
		});
		expect(due[0].payload).not.toHaveProperty('code');
	});

	it('asks for confirmed bookings starting within a day that are not over', async () => {
		await definition().due(NOW);

		const { sql, params } = new SQLiteSyncDialect().sqlToQuery(whereArg!);
		expect(sql).toContain('"status" = ?');
		expect(params).toContain('confirmed');
		expect(sql).toContain('"starts_at" < ?');
		expect(params).toContain(Math.floor((NOW.getTime() + 86_400_000) / 1000));
		expect(sql).toContain('"ends_at" > ?');
		// A per-booking code is not what makes it owed any more.
		expect(sql).not.toContain('lock_synced_at');
		expect(sql).not.toContain('lock_code');
	});

	it('is withheld while the member owes a fee, and owed again once it is paid (#2859)', async () => {
		rows = [booking('res-owing', 'u-owing'), booking('res-clear', 'u-clear')];
		owing.ids = new Set(['u-owing']);
		expect((await definition().due(NOW)).map((d) => d.subjectId)).toEqual(['res-clear']);

		owing.ids = new Set();
		expect((await definition().due(NOW)).map((d) => d.subjectId)).toEqual([
			'res-owing',
			'res-clear'
		]);
	});

	it('is not sent to a member who already holds a standing code', async () => {
		rows = [booking('res-keyholder', 'u-key'), booking('res-member', 'u-member')];
		standing.ids = new Set(['u-key']);

		expect((await definition().due(NOW)).map((d) => d.subjectId)).toEqual(['res-member']);
	});
});
