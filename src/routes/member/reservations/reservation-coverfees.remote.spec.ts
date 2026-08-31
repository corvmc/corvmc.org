import { describe, it, expect, vi } from 'vitest';
import { mockUser } from '$lib/server/db/test-factory';

// Regression: checkbox/toggle fields submit real booleans (SvelteKit's `b:` prefix
// coerces the value), so the reservation payment schemas must accept `coverFees` as a
// boolean. Previously they declared it as `z.enum(['','on'])` / `z.literal('on')` and
// rejected the boolean with "Invalid option: expected one of \"\"|\"on\"".
//
// The `form` mock captures the schema so we can validate it directly (the handler path
// needs a full request context that isn't relevant to this check).

vi.mock('$lib/server/reservation/reservation-service', () => ({
	create: vi.fn(),
	createWaitlisted: vi.fn(),
	confirm: vi.fn(),
	cancel: vi.fn(),
	markComplete: vi.fn(),
	markNoShow: vi.fn(),
	recordCashAndComplete: vi.fn(),
	staffCreate: vi.fn(),
	ReservationConflictError: class extends Error {}
}));
vi.mock('$lib/server/reservation/timezone', () => ({
	formatDateInTz: vi.fn(() => ''),
	buildDateInTz: vi.fn((date: string, time: string) => new Date(`${date}T${time}:00`))
}));
// `termsFor` and `getBookingTerms` come through real: they are pure, and a
// stubbed rate resolver would let this spec pass while the resolver it is
// standing in for returned something else. Only the config *read* is faked.
vi.mock('$lib/server/reservation/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/reservation/config')>()),
	getReservationConfig: vi.fn(async () => ({ hourlyRateCents: 1500 }))
}));
vi.mock('$lib/server/reservation/recurring-series-service', () => ({ create: vi.fn() }));
vi.mock('$lib/server/feature-flags', () => ({ requireFeature: vi.fn(async () => undefined) }));
vi.mock('$lib/server/db', () => ({ db: { select: () => ({}) } }));

const testUser = mockUser({ id: 'user-1', name: 'Test Member', email: 'member@example.com' });

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: testUser },
		url: new URL('http://localhost/member/reservations'),
		request: { headers: new Headers() }
	}),
	form: (schema: unknown, handler: (...args: any[]) => any) => {
		const fn = handler;
		(fn as any).__ = { type: 'form' };
		(fn as any).__schema = schema;
		(fn as any).for = () => fn;
		return fn;
	},
	query: (...args: any[]) => {
		const handler = typeof args[0] === 'function' ? args[0] : args[1];
		const fn = handler as (...a: any[]) => any;
		(fn as any).__ = { type: 'query' };
		return fn;
	}
}));

const { bookAndPayReservation, payForReservation, payReservation } =
	(await import('$lib/remote/reservations.remote')) as any;

const baseBooking = { date: '2026-06-15', startTime: '09:00', endTime: '10:00' };

describe('reservation coverFees accepts a boolean', () => {
	it('bookAndPayReservation parses coverFees: true', () => {
		const parsed = bookAndPayReservation.__schema.parse({ ...baseBooking, coverFees: true });
		expect(parsed.coverFees).toBe(true);
	});

	it('bookAndPayReservation defaults coverFees to false when omitted', () => {
		const parsed = bookAndPayReservation.__schema.parse(baseBooking);
		expect(parsed.coverFees).toBe(false);
	});

	it('payForReservation parses coverFees as a boolean', () => {
		expect(payForReservation.__schema.parse({ id: 'r1', coverFees: true }).coverFees).toBe(true);
		expect(payForReservation.__schema.parse({ id: 'r1' }).coverFees).toBe(false);
	});

	it('payReservation parses coverFees as a boolean', () => {
		expect(payReservation.__schema.parse({ coverFees: true }).coverFees).toBe(true);
		expect(payReservation.__schema.parse({}).coverFees).toBe(false);
	});
});
