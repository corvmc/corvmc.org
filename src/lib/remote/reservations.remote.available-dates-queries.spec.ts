import { describe, it, expect, vi } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';

// getAvailableDates reads the whole booking window in a constant number of
// queries — one per source (reservations, closures) — not one per day (#1775).
// The conflict service runs for real here; only the database is faked.

function chainable(): any {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') return (resolve: (v: unknown[]) => void) => resolve([]);
			return () => proxy;
		}
	});
	return proxy;
}

const select = vi.fn(() => chainable());

vi.mock('$lib/server/db', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/db')>()),
	db: { select }
}));

vi.mock('$lib/server/reservation/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/reservation/config')>()),
	getReservationConfig: vi.fn(async () => ({
		operatingHoursStart: '09:00',
		operatingHoursEnd: '22:00',
		minDurationHours: 1,
		maxDurationHours: 8,
		timeSlotMinutes: 30,
		bufferMinutes: 0,
		minAdvanceMinutes: 60,
		maxAdvanceDaysOneoff: 14,
		maxAdvanceDaysRecurring: 17.5
	}))
}));

const testUser = mockUser({ id: 'user-1', name: 'Test Member', email: 'member@example.com' });

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: testUser },
		url: new URL('http://localhost/member/reservations'),
		request: { headers: new Headers() }
	}),
	command: (_schema: unknown, handler: (...args: any[]) => any) => {
		(handler as any).__ = { type: 'command' };
		return handler;
	},
	form: (_schema: unknown, handler: (...args: any[]) => any) => {
		(handler as any).__ = { type: 'form' };
		(handler as any).for = () => handler;
		return handler;
	},
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as any;
		handler.__ = { type: 'query' };
		return handler;
	}
}));

const { getAvailableDates } = (await import('$lib/remote/reservations.remote')) as any;

describe('getAvailableDates query count', () => {
	it('reads reservations and closures once for the whole window, not once per day', async () => {
		select.mockClear();
		const dates: string[] = await getAvailableDates();

		// Today may be past closing, so 13 or 14 days are offered; either way the
		// window spans many days and the read count must not scale with it.
		expect(dates.length).toBeGreaterThanOrEqual(13);
		expect(select).toHaveBeenCalledTimes(2);
	});
});
