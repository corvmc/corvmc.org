import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/**
 * Stands in for the request event. Remote functions do not run inside a route
 * load — they are their own endpoint under `/_app/remote/...` and take the
 * pathname they resolve params against from a *client-supplied header*. So
 * `params` here is whatever page the browser believed it was on when it issued
 * the request, which is not necessarily the page the query was written for.
 */
const params: Record<string, string | undefined> = {};
vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ params, locals: { user: { id: 'user-1' } } })
}));

const requireUser = vi.fn(() => ({ id: 'user-1' }));
const hasAnyRole = vi.fn(async () => false);
vi.mock('$lib/server/authorization', () => ({
	requireUser: () => requireUser(),
	hasAnyRole: (...a: unknown[]) => hasAnyRole(...(a as []))
}));

const getBySlug = vi.fn(async () => null as unknown);
const getUserRole = vi.fn(async () => null as unknown);
vi.mock('$lib/server/band/band-service', () => ({
	getBySlug: (...a: unknown[]) => getBySlug(...(a as [])),
	getUserRole: (...a: unknown[]) => getUserRole(...(a as []))
}));

import {
	requireBandBySlug,
	requireBandMember,
	requireBandMemberOrStaff,
	requireBandAdmin
} from './band-context';

const BAND = { id: 'band-1', slug: 'our-band', name: 'Our Band' };

beforeEach(() => {
	delete params.slug;
	getBySlug.mockReset();
	getBySlug.mockResolvedValue(null);
	getUserRole.mockReset();
	getUserRole.mockResolvedValue(null);
	hasAnyRole.mockReset();
	hasAnyRole.mockResolvedValue(false);
});

/** Pull the status off a thrown kit `HttpError` without depending on its class. */
async function statusOf(fn: () => Promise<unknown>): Promise<number> {
	try {
		await fn();
	} catch (e) {
		return (e as { status?: number }).status ?? 0;
	}
	throw new Error('expected the guard to throw, but it resolved');
}

describe('band-context guards', () => {
	describe('with a slug in the request context', () => {
		it('resolves the band', async () => {
			params.slug = 'our-band';
			getBySlug.mockResolvedValue(BAND);

			await expect(requireBandBySlug()).resolves.toEqual(BAND);
			expect(getBySlug).toHaveBeenCalledWith('our-band');
		});

		it('404s an unknown slug', async () => {
			params.slug = 'no-such-band';
			await expect(statusOf(requireBandBySlug)).resolves.toBe(404);
		});
	});

	/**
	 * Regression test for JAVASCRIPT-SVELTEKIT-2T.
	 *
	 * `getBandUpcoming` is mounted only on `/band/[slug]`, yet the crash arrived
	 * on a `GET /member/reservations` transaction: the user navigated away while
	 * the query was in flight, so the request carried the *new* pathname and
	 * `params.slug` came back undefined. `requireBandBySlug` asserted the slug
	 * non-null with `params.slug!` and handed `undefined` to drizzle, which D1
	 * rejected with `D1_TYPE_ERROR: Type 'undefined' not supported` — a 500,
	 * reported as a crash, for what is really just a raced navigation.
	 *
	 * The guard has to answer a missing slug itself, before any query is built.
	 */
	describe('with no slug in the request context (raced navigation)', () => {
		beforeEach(() => {
			// What D1 actually does when a bound parameter is `undefined`, rather
			// than the benign `null` the happy-path mock returns. Without this the
			// guard's bug reads as a tidy 404 and the test proves nothing.
			getBySlug.mockImplementation(async (slug: unknown) => {
				if (typeof slug !== 'string') {
					throw new Error("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
				}
				return null;
			});
		});

		it('400s instead of querying with an undefined slug', async () => {
			await expect(statusOf(requireBandBySlug)).resolves.toBe(400);
			expect(getBySlug).not.toHaveBeenCalled();
		});

		it.each([
			['requireBandMember', requireBandMember],
			['requireBandMemberOrStaff', requireBandMemberOrStaff],
			['requireBandAdmin', requireBandAdmin]
		])('%s 400s without reaching the database', async (_name, guard) => {
			await expect(statusOf(guard)).resolves.toBe(400);
			expect(getBySlug).not.toHaveBeenCalled();
			expect(getUserRole).not.toHaveBeenCalled();
		});
	});
});
