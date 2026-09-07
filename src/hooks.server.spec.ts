import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Both the real `sentryHandle()` and SvelteKit's real `sequence()` reach for the
// request async-context store, which isn't set up when calling `handle` directly
// in a unit test. Mock Sentry to no-ops, and reimplement `sequence` as plain
// composition. (It used to just return the last handler — that silently stopped
// exercising handleBetterAuth the moment another handler was appended after it.)
vi.mock('@sentry/sveltekit', () => ({
	initCloudflareSentryHandle:
		() =>
		({ event, resolve }: { event: unknown; resolve: (event: unknown) => unknown }) =>
			resolve(event),
	sentryHandle:
		() =>
		({ event, resolve }: { event: unknown; resolve: (event: unknown) => unknown }) =>
			resolve(event),
	handleErrorWithSentry: <T>(handler: T) => handler
}));

type TestHandle = (input: {
	event: unknown;
	resolve: (event: unknown) => unknown;
}) => unknown | Promise<unknown>;

vi.mock('@sveltejs/kit/hooks', () => ({
	sequence:
		(...handlers: TestHandle[]): TestHandle =>
		({ event, resolve }) =>
			handlers.reduceRight<(e: unknown) => unknown>(
				(next, handler) => (e) => handler({ event: e, resolve: next }),
				resolve
			)(event)
}));

const mockRegisterListeners = vi.fn();
vi.mock('$lib/server/event-bus/register-listeners', () => ({
	registerListeners: (...args: unknown[]) => mockRegisterListeners(...args)
}));

vi.mock('$app/environment', () => ({
	building: false,
	dev: false
}));

const mockGetSession = vi.fn();
vi.mock('$lib/server/auth', () => ({
	auth: {
		api: {
			getSession: (...args: unknown[]) => mockGetSession(...args)
		}
	}
}));

const mockSvelteKitHandler = vi.fn();
vi.mock('better-auth/svelte-kit', () => ({
	svelteKitHandler: (...args: unknown[]) => mockSvelteKitHandler(...args)
}));

vi.mock('$lib/server/db', () => ({
	initDb: vi.fn()
}));

vi.mock('$lib/server/storage', () => ({
	initStorage: vi.fn()
}));

vi.mock('$lib/server/kv', () => ({
	initKv: vi.fn()
}));

const mockResolvePendingInvites = vi.fn();
vi.mock('$lib/server/group/group-invite-service', () => ({
	resolvePendingInvites: (...args: unknown[]) => mockResolvePendingInvites(...args)
}));

const mockCaptureException = vi.fn();
vi.mock('$lib/server/sentry', () => ({
	captureException: (...args: unknown[]) => mockCaptureException(...args)
}));

// Pinned so the host-scoped headers are tested against a known base domain
// rather than whatever PUBLIC_SITE_URL the checkout's .env happens to carry.
vi.mock('$env/dynamic/public', () => ({
	env: { PUBLIC_SITE_URL: 'https://corvmc.org' }
}));

const mockResolveBandSubdomain = vi.fn();
vi.mock('$lib/server/band/band-host-service', () => ({
	resolveBandSubdomain: (...args: unknown[]) => mockResolveBandSubdomain(...args)
}));

const mockResolveBandSlug = vi.fn();
vi.mock('$lib/server/band/band-address-service', () => ({
	resolveBandSlug: (...args: unknown[]) => mockResolveBandSlug(...args)
}));

beforeEach(() => {
	vi.clearAllMocks();
	mockSvelteKitHandler.mockResolvedValue(new Response('ok'));
	mockResolvePendingInvites.mockResolvedValue(undefined);
	mockResolveBandSubdomain.mockResolvedValue(null);
	mockResolveBandSlug.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides?: Record<string, unknown>) {
	return {
		request: new Request('http://localhost/', { method: 'GET' }),
		// SvelteKit always supplies `url`; the band-subdomain gate in the handle
		// chain reads its hostname to decide whether the request is a band address.
		url: new URL('http://localhost/'),
		locals: {} as Record<string, unknown>,
		platform: {},
		...overrides
	};
}

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

// The import stays dynamic so it resolves after the `vi.mock` calls above, and
// sits at module scope so the cold Vite transform of the whole module graph is
// paid once, during file evaluation — not inside a test or hook, where it would
// race the 5s test / 10s hook timeout on a cold `node_modules/.vite`.
const { handle, isLocalOriginEvent, handleError, RESOLVED_SESSIONS_MAX } =
	await import('./hooks.server');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hooks.server handle', () => {
	it('calls registerListeners when handling a request', async () => {
		mockGetSession.mockResolvedValue(null);

		await handle({ event: makeEvent() as any, resolve: vi.fn() });

		expect(mockRegisterListeners).toHaveBeenCalled();
	});

	it('populates locals.user and locals.session when session exists', async () => {
		const mockSession = {
			session: { id: 'sess-1', userId: 'user-1' },
			user: { id: 'user-1', name: 'Alice', email: 'alice@test.com' }
		};
		mockGetSession.mockResolvedValue(mockSession);

		const event = makeEvent();
		const resolve = vi.fn();

		await handle({ event: event as any, resolve });

		expect(event.locals.user).toEqual(mockSession.user);
		expect(event.locals.session).toEqual(mockSession.session);
	});

	it('treats a deactivated user (deletedAt set) as anonymous', async () => {
		const mockSession = {
			session: { id: 'sess-del', userId: 'user-del' },
			user: {
				id: 'user-del',
				name: 'Deleted',
				email: 'deleted@test.com',
				deletedAt: new Date('2026-01-01')
			}
		};
		mockGetSession.mockResolvedValue(mockSession);

		const event = makeEvent();

		await handle({ event: event as any, resolve: vi.fn() });

		expect(event.locals.user).toBeUndefined();
		expect(event.locals.session).toBeUndefined();
		expect(mockResolvePendingInvites).not.toHaveBeenCalled();
	});

	it('does not populate locals when session is null', async () => {
		mockGetSession.mockResolvedValue(null);

		const event = makeEvent();
		const resolve = vi.fn();

		await handle({ event: event as any, resolve });

		expect(event.locals.user).toBeUndefined();
		expect(event.locals.session).toBeUndefined();
	});

	it('resolves pending invites on first session encounter', async () => {
		const mockSession = {
			session: { id: 'sess-new', userId: 'user-2' },
			user: { id: 'user-2', name: 'Bob', email: 'bob@test.com' }
		};
		mockGetSession.mockResolvedValue(mockSession);

		const event = makeEvent();
		const resolve = vi.fn();

		await handle({ event: event as any, resolve });

		expect(mockResolvePendingInvites).toHaveBeenCalledWith('user-2', 'bob@test.com');
	});

	/**
	 * The dedupe itself, which nothing asserted before — the Set existed to skip
	 * the second call and no test proved it did.
	 *
	 * Fresh session ids in every case below: the module is imported once at file
	 * scope, so the Set outlives `vi.clearAllMocks()` and an id reused from
	 * another test would already be marked.
	 */
	it('skips the resolve on a second encounter of the same session', async () => {
		const mockSession = {
			session: { id: 'sess-dedupe', userId: 'user-3' },
			user: { id: 'user-3', name: 'Cara', email: 'cara@test.com' }
		};
		mockGetSession.mockResolvedValue(mockSession);

		await handle({ event: makeEvent() as any, resolve: vi.fn() });
		await handle({ event: makeEvent() as any, resolve: vi.fn() });

		expect(mockResolvePendingInvites).toHaveBeenCalledTimes(1);
	});

	/**
	 * A Worker isolate lives across many requests, and this Set only ever grew.
	 * Past the ceiling it clears rather than evicting one entry: a re-resolve
	 * costs one indexed SELECT that returns nothing, so precision is not worth an
	 * LRU here. What matters is that it is bounded at all.
	 */
	it('stays bounded past its ceiling, at the price of re-resolving', async () => {
		for (let i = 0; i < RESOLVED_SESSIONS_MAX; i++) {
			mockGetSession.mockResolvedValue({
				session: { id: `sess-bulk-${i}`, userId: `user-bulk-${i}` },
				user: { id: `user-bulk-${i}`, name: 'Bulk', email: `bulk-${i}@test.com` }
			});
			await handle({ event: makeEvent() as any, resolve: vi.fn() });
		}

		// The ceiling-th distinct id cleared the set, so the very first one is no
		// longer remembered and resolves a second time. Asserted through the
		// handle rather than by reading the Set — the bound is the behaviour, and
		// exporting a mutable module-scope collection to prove it would be worse
		// than the bug.
		mockGetSession.mockResolvedValue({
			session: { id: 'sess-bulk-0', userId: 'user-bulk-0' },
			user: { id: 'user-bulk-0', name: 'Bulk', email: 'bulk-0@test.com' }
		});
		vi.clearAllMocks();
		await handle({ event: makeEvent() as any, resolve: vi.fn() });

		expect(mockResolvePendingInvites).toHaveBeenCalledWith('user-bulk-0', 'bulk-0@test.com');
	});

	it('delegates to svelteKitHandler', async () => {
		mockGetSession.mockResolvedValue(null);

		const event = makeEvent();
		const resolve = vi.fn();

		await handle({ event: event as any, resolve });

		// `resolve` here is the next handler in the chain, not the raw mock passed
		// in — that is what being one link in a sequence means.
		expect(mockSvelteKitHandler).toHaveBeenCalledWith(
			expect.objectContaining({ event, resolve: expect.any(Function) })
		);
	});
});

describe('hooks.server isLocalOriginEvent', () => {
	it('drops events from the local preview server (JAVASCRIPT-SVELTEKIT-1Y)', async () => {
		expect(
			isLocalOriginEvent({ request: { url: 'http://localhost:4173/_app/version.json' } })
		).toBe(true);
	});

	it('keeps events from production', async () => {
		expect(isLocalOriginEvent({ request: { url: 'https://corvmc.org/api/stripe/webhook' } })).toBe(
			false
		);
	});

	it('keeps events with no request URL rather than dropping them blind', async () => {
		expect(isLocalOriginEvent({})).toBe(false);
	});
});

describe('hooks.server handleError', () => {
	it('does not report 4xx client errors (e.g. bot /.well-known probes)', async () => {
		await handleError({
			error: new Error('Not found: /.well-known/traffic-advice'),
			event: makeEvent({ url: new URL('http://localhost/.well-known/traffic-advice') }) as any,
			status: 404,
			message: 'Not Found'
		});

		expect(mockCaptureException).not.toHaveBeenCalled();
	});

	it('reports genuine 5xx errors to Sentry', async () => {
		const error = new Error('boom');

		await handleError({
			error,
			event: makeEvent({ url: new URL('http://localhost/member') }) as any,
			status: 500,
			message: 'Internal Error'
		});

		expect(mockCaptureException).toHaveBeenCalledWith(error);
	});
});

// ---------------------------------------------------------------------------
// Security headers (#628)
// ---------------------------------------------------------------------------

describe('hooks.server security headers', () => {
	async function respond(href: string) {
		mockGetSession.mockResolvedValue(null);
		// The real svelteKitHandler calls through for anything that isn't a
		// better-auth route; the shared mock returns a canned Response, which would
		// leave the band-subdomain gate below it unreachable.
		mockSvelteKitHandler.mockImplementation(
			({ event, resolve }: { event: unknown; resolve: (e: unknown) => unknown }) => resolve(event)
		);
		const url = new URL(href);
		const event = makeEvent({ url, request: new Request(href, { method: 'GET' }) });
		return (await handle({
			event: event as any,
			resolve: vi.fn().mockResolvedValue(new Response('ok'))
		})) as Response;
	}

	it('sets the always-on headers on an ordinary response', async () => {
		const response = await respond('https://corvmc.org/');

		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
		expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
	});

	it('sends HSTS for the app domain and its subdomains', async () => {
		const apex = await respond('https://corvmc.org/');
		expect(apex.headers.get('strict-transport-security')).toBe(
			'max-age=31536000; includeSubDomains'
		);

		mockResolveBandSubdomain.mockResolvedValue({
			slug: 'the-neons',
			kind: 'band',
			servesSite: true
		});
		const subdomain = await respond('https://the-neons.corvmc.org/');
		expect(subdomain.headers.get('strict-transport-security')).toBe(
			'max-age=31536000; includeSubDomains'
		);
	});

	// A premium band's own domain reaches this worker through the `*/*` zone
	// route. HSTS there would pin an apex we do not own, and survive the band
	// leaving CMC.
	it('does not send HSTS on a band custom domain, but still sends the rest', async () => {
		const response = await respond('https://theband.com/');

		expect(response.headers.get('strict-transport-security')).toBeNull();
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	});

	it('does not send HSTS over plain http', async () => {
		const response = await respond('http://corvmc.org/');

		expect(response.headers.get('strict-transport-security')).toBeNull();
	});

	// handleBandSubdomain builds these by hand and never calls resolve, so a
	// header handler placed below it in the sequence would miss them entirely.
	it('sets headers on the free-band redirect, which never calls resolve', async () => {
		mockResolveBandSubdomain.mockResolvedValue({
			slug: 'tiny-band',
			kind: 'band',
			servesSite: false
		});

		const response = await respond('https://tiny-band.corvmc.org/events');

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('https://corvmc.org/directory/bands/tiny-band');
		expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
		expect(response.headers.get('strict-transport-security')).toBe(
			'max-age=31536000; includeSubDomains'
		);
	});

	it('sets headers on the moved-slug redirect', async () => {
		mockResolveBandSubdomain.mockResolvedValue(null);
		mockResolveBandSlug.mockResolvedValue({ kind: 'moved', slug: 'the-neons' });

		const response = await respond('https://old-name.corvmc.org/epk');

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('https://the-neons.corvmc.org/epk');
		expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
	});
});
