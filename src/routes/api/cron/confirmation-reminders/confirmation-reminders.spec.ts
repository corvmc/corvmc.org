import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let queryResult: unknown[] = [];

function chainable(result?: unknown[]) {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(result ?? queryResult);
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chainable()
	}
}));

vi.mock('$lib/server/db/schema/reservation', () => ({
	reservation: {
		id: 'id',
		status: 'status',
		bookerType: 'booker_type',
		startsAt: 'starts_at',
		endsAt: 'ends_at',
		createdByUserId: 'created_by_user_id'
	}
}));

vi.mock('$lib/server/db/schema/authentication', () => ({
	user: { id: 'id', name: 'name', email: 'email' }
}));

const mockNe = vi.fn();
vi.mock('drizzle-orm', () => ({
	eq: vi.fn(),
	and: vi.fn(),
	gte: vi.fn(),
	lt: vi.fn(),
	ne: (...args: unknown[]) => mockNe(...args)
}));

vi.mock('luxon', () => ({
	DateTime: {
		fromJSDate: () => ({
			setZone: () => ({
				toLocaleString: (fmt: any) => (fmt === 'DATE_FULL' ? 'May 15, 2026' : '10:00 AM')
			})
		}),
		DATE_FULL: 'DATE_FULL',
		TIME_SIMPLE: 'TIME_SIMPLE'
	}
}));

const mockEmit = vi.fn();
vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: { emit: mockEmit }
}));

vi.mock('$env/dynamic/private', () => ({
	env: { CRON_SECRET: 'test-secret' }
}));

beforeEach(() => {
	vi.clearAllMocks();
	queryResult = [];
});

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

// The import stays dynamic so it resolves after the `vi.mock` calls above, and
// sits at module scope so the cold Vite transform of the whole module graph is
// paid once, during file evaluation — not inside a test or hook, where it would
// race the 5s test / 10s hook timeout on a cold `node_modules/.vite`.
const { POST } = await import('./+server');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/cron/confirmation-reminders', () => {
	it('rejects requests without valid auth', async () => {
		await expect(
			POST({
				request: new Request('http://localhost/api/cron/confirmation-reminders', {
					method: 'POST',
					headers: { Authorization: 'Bearer wrong-secret' }
				})
			} as any)
		).rejects.toThrow();
	});

	it('emits reservation.confirmation_reminder_due for each unconfirmed reservation', async () => {
		const tomorrow = new Date(Date.now() + 12 * 60 * 60 * 1000);
		const tomorrowEnd = new Date(tomorrow.getTime() + 3600000);

		queryResult = [
			{
				id: 'res-1',
				startsAt: tomorrow,
				endsAt: tomorrowEnd,
				userId: 'user-1',
				userName: 'Alice',
				userEmail: 'alice@example.com'
			},
			{
				id: 'res-2',
				startsAt: tomorrow,
				endsAt: tomorrowEnd,
				userId: 'user-2',
				userName: 'Bob',
				userEmail: 'bob@example.com'
			}
		];

		const response = await POST({
			request: new Request('http://localhost/api/cron/confirmation-reminders', {
				method: 'POST',
				headers: { Authorization: 'Bearer test-secret' }
			})
		} as any);

		const body = (await response.json()) as any;

		expect(body.found).toBe(2);
		expect(body.emitted).toBe(2);
		expect(mockEmit).toHaveBeenCalledTimes(2);
		expect(mockEmit).toHaveBeenCalledWith(
			'reservation.confirmation_reminder_due',
			expect.objectContaining({
				reservationId: 'res-1',
				userId: 'user-1',
				userName: 'Alice',
				userEmail: 'alice@example.com'
			})
		);
		expect(mockEmit).toHaveBeenCalledWith(
			'reservation.confirmation_reminder_due',
			expect.objectContaining({
				reservationId: 'res-2',
				userId: 'user-2'
			})
		);
	});

	it('returns zero when no reservations match', async () => {
		queryResult = [];

		const response = await POST({
			request: new Request('http://localhost/api/cron/confirmation-reminders', {
				method: 'POST',
				headers: { Authorization: 'Bearer test-secret' }
			})
		} as any);

		const body = (await response.json()) as any;

		expect(body.found).toBe(0);
		expect(body.emitted).toBe(0);
		expect(mockEmit).not.toHaveBeenCalled();
	});

	it('continues emitting if one reservation fails', async () => {
		queryResult = [
			{
				id: 'res-fail',
				startsAt: new Date(),
				endsAt: new Date(),
				userId: 'user-1',
				userName: 'Alice',
				userEmail: 'alice@example.com'
			},
			{
				id: 'res-ok',
				startsAt: new Date(),
				endsAt: new Date(),
				userId: 'user-2',
				userName: 'Bob',
				userEmail: 'bob@example.com'
			}
		];

		mockEmit.mockRejectedValueOnce(new Error('dispatch failed')).mockResolvedValueOnce(undefined);

		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const response = await POST({
			request: new Request('http://localhost/api/cron/confirmation-reminders', {
				method: 'POST',
				headers: { Authorization: 'Bearer test-secret' }
			})
		} as any);

		const body = (await response.json()) as any;

		expect(body.found).toBe(2);
		expect(body.emitted).toBe(1);
		expect(mockEmit).toHaveBeenCalledTimes(2);
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('res-fail'), expect.any(Error));

		consoleSpy.mockRestore();
	});

	// Regression: space booked for an event is staff-held, with no member
	// confirm/pay flow — nagging the staff creator to confirm it is noise.
	it('excludes event-booked space from the query', async () => {
		await POST({
			request: new Request('http://localhost/api/cron/confirmation-reminders', {
				method: 'POST',
				headers: { Authorization: 'Bearer test-secret' }
			})
		} as any);

		expect(mockNe).toHaveBeenCalledWith('booker_type', 'event');
	});
});
