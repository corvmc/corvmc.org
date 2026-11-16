import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// #3141: booking and cancel answer once their rows are written. Every external
// call (U-tec, Postmark, any fetch) is held on a gate the test opens only after
// the remote has replied, so one awaited inline keeps the remote from replying
// and the test times out. Stripe checkout and refund are mocked: the member
// needs the checkout URL, and a failed refund is surfaced to staff.
// Real reservation-service, real event bus and listeners, over a real SQLite.

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});
vi.mock('#lib/server/db/index.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/db/index.js')>()),
	db: testDb
}));

const gate = vi.hoisted(() => {
	let open!: () => void;
	const opened = new Promise<void>((resolve) => (open = resolve));
	const calls: string[] = [];
	const held =
		<T>(name: string, value: T) =>
		async (..._args: unknown[]): Promise<T> => {
			calls.push(name);
			await opened;
			return value;
		};
	return { open, opened, calls, held };
});

vi.mock('#lib/server/lock/ultraloc-client.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/lock/ultraloc-client.js')>()),
	createTemporaryUser: gate.held('utec.createTemporaryUser', 77),
	addLockUser: gate.held('utec.addLockUser', 77),
	removeTemporaryUser: gate.held('utec.removeTemporaryUser', undefined),
	updateLockUser: gate.held('utec.updateLockUser', undefined),
	listLockUsers: gate.held('utec.listLockUsers', []),
	getLockUser: gate.held('utec.getLockUser', null),
	queryDeviceHealth: gate.held('utec.queryDeviceHealth', { online: true })
}));
vi.mock('#lib/server/notification/email/postmark-client.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/notification/email/postmark-client.js')>()),
	sendTemplatedEmails: gate.held('postmark.sendTemplatedEmails', []),
	sendHtmlEmails: gate.held('postmark.sendHtmlEmails', []),
	sendEmailWithTemplate: gate.held('postmark.sendEmailWithTemplate', undefined),
	sendTemplateBatch: gate.held('postmark.sendTemplateBatch', [])
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

/** Open the gate, then settle everything handed to `waitUntil`, including what that work defers. */
async function drainDeferred(): Promise<void> {
	gate.open();
	for (let settled = 0; settled < deferred.length; settled = deferred.length) {
		await Promise.all(deferred.slice(settled));
	}
}

const DAY = 24 * 60 * 60 * 1000;
const tomorrow = () => new Date(Date.now() + DAY).toISOString().slice(0, 10);

beforeEach(() => {
	deferred.length = 0;
	gate.calls.length = 0;
	registerWaitUntil((p) => deferred.push(p));
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: unknown) => {
			gate.calls.push(`fetch ${String(input)}`);
			await gate.opened;
			return new Response('{}');
		})
	);
	sqlite.exec('delete from reservation');
	sqlite.exec('delete from user');
	sqlite.exec(
		`insert into user (id, name, email, email_verified) values ('user-1', 'Test Member', 'member@example.com', 0)`
	);
});

afterEach(() => {
	registerWaitUntil(null);
	vi.unstubAllGlobals();
});

describe('bookAndPayReservation', () => {
	it('replies before the door code is minted, and the code is still minted', async () => {
		const result = await remote.bookAndPayReservation({
			date: tomorrow(),
			startTime: '18:00',
			endTime: '19:00',
			coverFees: false,
			skipPayment: 'on'
		});
		expect(result).toMatchObject({ confirmed: true });

		await drainDeferred();

		expect(gate.calls).toContain('utec.createTemporaryUser');
		const row = sqlite
			.prepare('select lock_access_id as access from reservation where id = ?')
			.get(result.reservationId) as { access: string | null };
		expect(row.access).toBe('77');
	});
});

describe('cancelReservation', () => {
	it('replies before the door code is revoked, and the code is still revoked', async () => {
		const startsAt = Math.floor((Date.now() + DAY) / 1000);
		sqlite
			.prepare(
				`insert into reservation (id, booker_type, booker_id, created_by_user_id, status, starts_at, ends_at,
				                          lock_code, lock_access_id)
				 values ('res-1', 'user', 'user-1', 'user-1', 'confirmed', ?, ?, '123456', '55')`
			)
			.run(startsAt, startsAt + 3600);

		expect(await remote.cancelReservation({ id: 'res-1' })).toEqual({ success: true });

		await drainDeferred();

		expect(gate.calls).toContain('utec.removeTemporaryUser');
		const row = sqlite
			.prepare('select status, lock_code as code from reservation where id = ?')
			.get('res-1') as { status: string; code: string | null };
		expect(row).toEqual({ status: 'cancelled', code: null });
	});
});
