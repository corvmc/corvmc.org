import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// #3156: a booking cancelled within seconds of being made. The provision and the
// revoke both run after the response (#3141), so the provision can reach U-tec
// after the revoke has found nothing to remove. A fake lock records which users
// are live; each test holds the provision at one point and releases it after the
// cancel's deferred work has settled. Real services, bus and listeners over SQLite.

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});
vi.mock('#lib/server/db/index.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/db/index.js')>()),
	db: testDb
}));

const lock = vi.hoisted(() => {
	const hold = () => {
		let release = () => {};
		let held = Promise.resolve();
		return {
			arm: () => (held = new Promise<void>((resolve) => (release = resolve))),
			release: () => release(),
			wait: () => held
		};
	};
	return {
		/** Between the provision's first read and the add. */
		beforeAdd: hold(),
		/** Inside the add, after it was sent. */
		duringAdd: hold(),
		calls: [] as string[],
		live: new Set<number>()
	};
});

vi.mock('#lib/server/lock/member-code-service.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('#lib/server/lock/member-code-service.js')>();
	return {
		...actual,
		hasActiveMemberCode: async (userId: string) => {
			await lock.beforeAdd.wait();
			return actual.hasActiveMemberCode(userId);
		}
	};
});
vi.mock('#lib/server/lock/ultraloc-client.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/lock/ultraloc-client.js')>()),
	createTemporaryUser: async () => {
		lock.calls.push('add 77');
		await lock.duringAdd.wait();
		lock.live.add(77);
		return 77;
	},
	removeTemporaryUser: async (id: number) => {
		lock.calls.push(`remove ${id}`);
		lock.live.delete(id);
	},
	listLockUsers: async () => [...lock.live].map((id) => ({ id, type: 2 })),
	getLockUser: async () => null,
	queryDeviceHealth: async () => ({ online: true })
}));
vi.mock('#lib/server/notification/email/postmark-client.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/notification/email/postmark-client.js')>()),
	sendTemplatedEmails: async () => [],
	sendHtmlEmails: async () => [],
	sendEmailWithTemplate: async () => undefined,
	sendTemplateBatch: async () => []
}));

const member = { id: 'user-1', name: 'Test Member', email: 'member@example.com' };

vi.mock('#lib/server/authorization.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/authorization.js')>()),
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

const { registerWaitUntil } = await import('#lib/server/after-response.js');
const { registerListeners } = await import('#lib/server/event-bus/register-listeners.js');
const remote = (await import('#lib/remote/reservations.remote.js')) as any;
await registerListeners();

const deferred: Promise<unknown>[] = [];

/** Settle what was handed to `waitUntil` from index `from` on, including what that work defers. */
async function settle(from = 0): Promise<void> {
	for (let done = from; done < deferred.length; done = deferred.length) {
		await Promise.all(deferred.slice(done));
	}
}

const DAY = 24 * 60 * 60 * 1000;
const tomorrow = () => new Date(Date.now() + DAY).toISOString().slice(0, 10);

const lockCode = (id: string) =>
	(
		sqlite.prepare('select lock_code as code from reservation where id = ?').get(id) as {
			code: string | null;
		}
	).code;

beforeEach(() => {
	deferred.length = 0;
	lock.calls.length = 0;
	lock.live.clear();
	registerWaitUntil((p) => deferred.push(p));
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response('{}'))
	);
	sqlite.exec('delete from reservation');
	sqlite.exec('delete from user');
	sqlite.exec(
		`insert into user (id, name, email, email_verified) values ('user-1', 'Test Member', 'member@example.com', 0)`
	);
});

afterEach(async () => {
	lock.beforeAdd.release();
	lock.duringAdd.release();
	await settle();
	registerWaitUntil(null);
	vi.unstubAllGlobals();
});

/** Book, then cancel and settle what the cancel deferred, with the provision still held. */
async function bookThenCancel(): Promise<string> {
	const booked = await remote.bookAndPayReservation({
		date: tomorrow(),
		startTime: '18:00',
		endTime: '19:00',
		coverFees: false,
		skipPayment: 'on'
	});
	expect(booked).toMatchObject({ confirmed: true });

	const fromCancel = deferred.length;
	expect(await remote.cancelReservation({ id: booked.reservationId })).toEqual({ success: true });
	await settle(fromCancel);
	return booked.reservationId;
}

describe('a booking cancelled before its door code is minted', () => {
	it('leaves no live code when the provision is released after the revoke', async () => {
		lock.beforeAdd.arm();
		const id = await bookThenCancel();

		lock.beforeAdd.release();
		await settle();

		expect(lock.live.size).toBe(0);
		expect(lockCode(id)).toBeNull();
	});

	it('removes the code when the add returns after the revoke', async () => {
		lock.duringAdd.arm();
		const id = await bookThenCancel();
		expect(lock.calls).toEqual(['add 77']);

		lock.duringAdd.release();
		await settle();

		expect(lock.calls).toEqual(['add 77', 'remove 77']);
		expect(lock.live.size).toBe(0);
		expect(lockCode(id)).toBeNull();
	});
});
