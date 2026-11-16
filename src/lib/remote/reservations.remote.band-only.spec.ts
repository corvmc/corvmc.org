/**
 * `bookBandReservation` books for a band and nothing else (#3036). A club or
 * committee booking is a program hold, which stays a staff action. The real
 * group guard runs here; only the group lookup beneath it is faked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const member = { id: 'user-1', email: 'u@example.com', name: 'U' };
vi.mock('#lib/server/authorization.js', () => ({
	requireUser: vi.fn(() => member),
	requireCapability: vi.fn(async () => member),
	can: vi.fn(async () => false)
}));

let kind = 'band';
vi.mock('#lib/server/band/band-service.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/band/band-service.js')>()),
	getBySlug: vi.fn(async (slug: string) => ({ id: 'group-1', slug, kind, deletedAt: null })),
	getUserRole: vi.fn(async () => 'member')
}));

const create = vi.fn(async () => ({ id: 'res-1' }));
vi.mock('#lib/server/reservation/reservation-service.js', () => ({
	create,
	staffCreate: vi.fn(),
	createWaitlisted: vi.fn(),
	confirm: vi.fn(),
	cancel: vi.fn()
}));
vi.mock('#lib/server/reservation/outstanding-fees.js', () => ({
	assertFeeGateAllows: vi.fn(async () => undefined),
	getFeeGate: vi.fn()
}));
vi.mock('#lib/server/user/user-service.js', () => ({
	ensureContactPhone: vi.fn(async () => true)
}));
vi.mock('#lib/server/reservation/config.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/reservation/config.js')>()),
	getReservationConfig: vi.fn(async () => ({ hourlyRateCents: 1500 })),
	getBookingTerms: vi.fn(async () => ({ hourlyRateCents: 1500 }))
}));

function chainable(): unknown {
	const proxy: unknown = new Proxy(() => proxy, {
		get(_t, prop) {
			if (prop === 'then') return (resolve: (v: unknown[]) => void) => resolve([]);
			return () => proxy;
		}
	});
	return proxy;
}
vi.mock('#lib/server/db/index.js', () => ({ db: { select: () => chainable() } }));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: { user: member }, url: new URL('https://example.org') }),
	query: (...a: unknown[]) => tag(a, 'query'),
	form: (...a: unknown[]) => tag(a, 'form'),
	command: (...a: unknown[]) => tag(a, 'command')
}));

function tag(args: unknown[], type: string) {
	const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
		...a: unknown[]
	) => Promise<unknown>;
	const fn =
		type === 'query'
			? (...a: unknown[]) => ({
					then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
						handler(...a).then(ok, ko),
					refresh: () => Promise.resolve()
				})
			: handler;
	Object.assign(fn, { __: { type }, for: () => fn });
	return fn;
}

const issue = new Proxy({}, { get: () => (m: string) => ({ message: m }) });
const { bookBandReservation } = (await import('./reservations.remote')) as unknown as Record<
	string,
	(d: unknown, i?: unknown) => Promise<unknown>
>;

const booking = {
	slug: 'the-group',
	date: '2026-09-15',
	startTime: '16:00',
	endTime: '18:00',
	notes: null,
	phone: '555-0100'
};

beforeEach(() => {
	vi.clearAllMocks();
	kind = 'band';
});

describe('bookBandReservation', () => {
	it.each(['club', 'committee'])('refuses a %s member with 404, writing nothing', async (k) => {
		kind = k;
		await expect(bookBandReservation(booking, issue)).rejects.toMatchObject({
			status: 404,
			body: { message: 'Band not found' }
		});
		expect(create).not.toHaveBeenCalled();
	});

	it('books for a band member', async () => {
		await bookBandReservation(booking, issue).catch(() => undefined);
		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({ bookerType: 'group', bookerId: 'group-1' })
		);
	});
});
