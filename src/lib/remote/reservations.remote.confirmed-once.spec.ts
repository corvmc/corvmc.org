import { describe, it, expect, vi, beforeEach } from 'vitest';

// #2502: a booking announces `reservation.confirmed` once, when it is created.
// Settling it afterwards moves money, not status, so it must not announce again.
// Real reservation-service over a real SQLite; only money and guards are faked.

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});
vi.mock('#lib/server/db/index.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/db/index.js')>()),
	db: testDb
}));

const member = { id: 'user-1', name: 'Test Member', email: 'member@example.com' };

vi.mock('#lib/server/authorization.js', () => ({
	can: vi.fn(async () => false),
	requireCapability: vi.fn(async () => member),
	requireCapabilityOrOwner: vi.fn(),
	requireUser: () => member
}));
vi.mock('#lib/server/reservation/conflict-service.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/reservation/conflict-service.js')>()),
	validateBooking: vi.fn(async () => ({ valid: true }))
}));
vi.mock('#lib/server/reservation/conflict-service', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/reservation/conflict-service')>()),
	validateBooking: vi.fn(async () => ({ valid: true }))
}));
vi.mock('#lib/server/reservation/config.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/reservation/config.js')>()),
	getReservationConfig: vi.fn(async () => ({ hourlyRateCents: 1500 }))
}));
// Free hours cover the whole session, so the settle is the credits one.
vi.mock('#lib/server/reservation/reservation-credit-service.js', async (importOriginal) => ({
	...(await importOriginal<
		typeof import('#lib/server/reservation/reservation-credit-service.js')
	>()),
	commitReservationCredits: vi.fn(async () => ({
		remainingCents: 0,
		creditDiscountCents: 1500,
		alreadyCommitted: false
	})),
	reverseReservationCredits: vi.fn()
}));
vi.mock('#lib/server/finance/reservation-entries.js', () => ({
	recordReservationCredit: vi.fn(async () => undefined),
	recordReservationCash: vi.fn(),
	recordReservationCardPresent: vi.fn()
}));
vi.mock('#lib/server/finance/payment-service.js', () => ({
	checkout: vi.fn(),
	recordCashPayment: vi.fn(async () => ({ paymentRecordId: 'rec-0' })),
	refund: vi.fn()
}));
vi.mock('#lib/server/finance/stripe-customer-service.js', () => ({
	ensureStripeCustomer: vi.fn(async () => 'cus_test')
}));
vi.mock('#lib/server/user/user-service.js', () => ({
	ensureContactPhone: vi.fn(async () => true)
}));
vi.mock('#lib/server/feature-flags.js', () => ({ requireFeature: vi.fn(async () => undefined) }));
vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: member },
		url: new URL('http://localhost/member/reservations'),
		request: { headers: new Headers() }
	}),
	command: (_schema: unknown, handler: (...args: any[]) => any) =>
		Object.assign(handler, { __: { type: 'command' } }),
	form: (_schema: unknown, handler: (...args: any[]) => any) => {
		const fn = (data: unknown) => handler(data, {});
		return Object.assign(fn, { __: { type: 'form' }, for: () => fn });
	},
	query: (...args: unknown[]) => {
		const fn = (typeof args[0] === 'function' ? args[0] : args[1]) as any;
		return Object.assign(fn, { __: { type: 'query' }, batch: fn });
	}
}));

const { domainEvents } = await import('#lib/server/event-bus/event-bus.js');
const remote = (await import('#lib/remote/reservations.remote.js')) as any;

const confirmed: string[] = [];
domainEvents.on('reservation.confirmed', ({ data }) => {
	confirmed.push(data.reservationId);
});

const DAY = 24 * 60 * 60 * 1000;
/** Far enough out that the old confirmation window would have held it. */
const date = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);

beforeEach(() => {
	confirmed.length = 0;
	sqlite.exec('delete from reservation');
	sqlite.exec('delete from user');
	sqlite.exec(
		`insert into user (id, name, email, email_verified) values ('user-1', 'Test Member', 'member@example.com', 0)`
	);
});

describe.each([
	['tomorrow', 1],
	['a month out', 30]
])('a booking %s', (_label, days) => {
	it('is confirmed on creation and announced once through a credits settle', async () => {
		const result = await remote.bookAndPayReservation({
			date: date(days),
			startTime: '18:00',
			endTime: '19:00',
			coverFees: false,
			skipPayment: 'on'
		});

		const row = sqlite
			.prepare('select status, cash_due_cents as due from reservation where id = ?')
			.get(result.reservationId) as { status: string; due: number };
		expect(row).toEqual({ status: 'confirmed', due: 0 });
		expect(confirmed).toEqual([result.reservationId]);
	});
});
