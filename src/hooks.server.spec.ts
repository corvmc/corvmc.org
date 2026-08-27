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
vi.mock('$lib/server/band/platform-invite-service', () => ({
	resolvePendingInvites: (...args: unknown[]) => mockResolvePendingInvites(...args)
}));

const mockCaptureException = vi.fn();
vi.mock('$lib/server/sentry', () => ({
	captureException: (...args: unknown[]) => mockCaptureException(...args)
}));

beforeEach(() => {
	vi.clearAllMocks();
	mockSvelteKitHandler.mockResolvedValue(new Response('ok'));
	mockResolvePendingInvites.mockResolvedValue(undefined);
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
const { handle, isLocalOriginEvent, handleError } = await import('./hooks.server');

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
