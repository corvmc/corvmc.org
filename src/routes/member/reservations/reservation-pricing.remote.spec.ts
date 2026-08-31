import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
//
// getReservations must show the *full* room price for uncommitted bookings and
// only flag that credits are available — it must NOT project a discounted price
// from the live free-hours balance. Projecting a discount on the listing drifts
// from the confirm/pay modal (which applies credits live, at the moment of the
// charge), producing the "$52.50 on the card but $120 at Pay Ahead" mismatch.
// Committed rows keep the real cash owed (cashDueCents).

let selectResult: unknown[] = [];

function chainable() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(selectResult);
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: { select: () => chainable() }
}));

vi.mock('$lib/server/site-config/site-config-service', () => ({
	config: vi.fn(async () => 1500) // reservation.hourlyRateCents → $15/hr
}));

// `termsFor` and `getBookingTerms` come through real: they are pure, and a
// stubbed rate resolver would let this spec pass while the resolver it is
// standing in for returned something else. Only the config *read* is faked.
vi.mock('$lib/server/reservation/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/reservation/config')>()),
	getReservationConfig: vi.fn(async () => ({ hourlyRateCents: 1500 }))
}));

let freeHoursBalance = 0;
vi.mock('$lib/server/finance/credit-service', () => ({
	getBalance: vi.fn(async () => freeHoursBalance)
}));

const testUser = mockUser({ id: 'user-1', name: 'Test Member', email: 'member@example.com' });

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: testUser },
		url: new URL('http://localhost/member/reservations'),
		request: { headers: new Headers() }
	}),
	form: (_schema: unknown, handler: (...args: any[]) => any) => {
		const fn = handler;
		(fn as any).__ = { type: 'form' };
		(fn as any).for = () => fn;
		return fn;
	},
	query: (...args: unknown[]) => {
		const handler = typeof args[0] === 'function' ? args[0] : args[1];
		const fn = handler as (...args: any[]) => any;
		(fn as any).__ = { type: 'query' };
		return fn;
	}
}));

const { getReservations } = (await import('$lib/remote/reservations.remote')) as any;

// An 8-hour booking: 8 × $15 = $120 gross.
function eightHourRow(overrides: Record<string, unknown> = {}) {
	const startsAt = new Date('2026-06-11T16:00:00Z');
	const endsAt = new Date('2026-06-12T00:00:00Z');
	return {
		id: 'res-8h',
		status: 'scheduled',
		startsAt,
		endsAt,
		cashDueCents: null,
		...overrides
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	selectResult = [];
	freeHoursBalance = 0;
});

describe('getReservations pricing', () => {
	it('shows the full price (not a projected discount) for an uncommitted booking when the member has free hours', async () => {
		freeHoursBalance = 16; // 8 hours of credits — enough to fully cover the booking
		selectResult = [eightHourRow()];

		const [row] = await getReservations();

		expect(row.price).toBe(120); // full $120, NOT discounted to $0
		expect(row.creditsAvailable).toBe(true); // indicator that credits will apply
	});

	it('does not flag creditsAvailable when the member has no free hours', async () => {
		freeHoursBalance = 0;
		selectResult = [eightHourRow()];

		const [row] = await getReservations();

		expect(row.price).toBe(120);
		expect(row.creditsAvailable).toBe(false);
	});

	it('shows the committed cash owed for a confirmed booking, regardless of live balance', async () => {
		freeHoursBalance = 16;
		selectResult = [eightHourRow({ status: 'confirmed', cashDueCents: 5250 })];

		const [row] = await getReservations();

		expect(row.price).toBe(52.5); // the real remainder, from cashDueCents
		expect(row.creditsAvailable).toBe(false); // already committed — nothing left to apply
	});

	it('shows $0 for a confirmed booking fully covered by credits', async () => {
		selectResult = [eightHourRow({ status: 'confirmed', cashDueCents: 0 })];

		const [row] = await getReservations();

		expect(row.price).toBe(0);
		expect(row.creditsAvailable).toBe(false);
	});
});
