import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

// Regression: the member and band profile forms decoded their JSON-encoded array
// fields with `.transform((s) => { try { return JSON.parse(s) } catch { return [] } })`.
// The catch is the defect. `instruments`, `genres` and `links` are written
// straight through to updateMemberProfile / updateBandProfile, which replace the
// stored value wholesale — so any submission whose hidden input was malformed
// (a truncated payload, a client-side serialisation bug, a hand-rolled POST)
// silently *erased* the member's instruments, genres and links instead of
// failing. This is the same shape as the role-wipe fixed in #162, where a
// silently-empty array wiped every role off a user on an unrelated field edit.
//
// jsonArrayField() reports a field issue instead, so the save is rejected and
// the stored value is left alone. These tests pin that: a malformed array field
// must NOT reach the handler.

const updateMemberProfile = vi.fn(async () => undefined);
const updateBandProfile = vi.fn(async () => ({ slug: 'the-regressions' }));

vi.mock('$lib/server/directory/profile-service', () => ({
	getMemberProfileForEdit: vi.fn(async () => null),
	updateMemberProfile: (...args: unknown[]) => updateMemberProfile(...(args as [])),
	getBandProfileForEdit: vi.fn(async () => null),
	updateBandProfile: (...args: unknown[]) => updateBandProfile(...(args as []))
}));

vi.mock('$lib/server/directory/directory-service', () => ({
	listMembers: vi.fn(),
	listBands: vi.fn(),
	getPublicDirectory: vi.fn(),
	getMemberProfile: vi.fn(),
	suggestInstruments: vi.fn(),
	suggestGenres: vi.fn()
}));

vi.mock('$lib/server/authorization', () => ({
	requireUser: () => ({ id: 'user-1', name: 'Member', email: 'member@example.com' })
}));

// A slug-derived band lookup, faithful to the real `requireGroupRole()`: it
// resolves the band from the ref it is handed and 404s when nothing matches.
//
// The submitted slug and the stored one are kept as separate variables on
// purpose. Since phase 4 the ref arrives as a form field rather than a route
// param, but it is still the slug the client held *before* the write — so the
// staleness these tests pin is the same one, arriving through a different door.
let submittedSlug = 'the-regressions';
let storedBandSlug = 'the-regressions';

const bandNotFound = () =>
	Object.assign(new Error('Band not found'), { status: 404, body: { message: 'Band not found' } });

vi.mock('$lib/server/group/group-context', () => ({
	requireGroupRole: vi.fn(async (ref: { slug?: string }) => {
		if ((ref.slug ?? submittedSlug) !== storedBandSlug) throw bandNotFound();
		return {
			user: { id: 'user-1' },
			group: { id: 'band-1', slug: storedBandSlug },
			role: 'admin'
		};
	})
}));

vi.mock('$lib/server/event/event-service', () => ({
	listBandEventsUpcoming: vi.fn(),
	listBandEventsPast: vi.fn(),
	countBandPastEvents: vi.fn(),
	listMemberUpcomingShows: vi.fn(),
	listMemberPastShows: vi.fn(),
	countMemberPastShows: vi.fn()
}));

// Faithful to band-service `update()`: the name is stored, the slug is left
// alone. Only an explicit address change moves a band's slug.
const updateBandBasics = vi.fn(async (_bandId: string, _data: { name?: string }) => {
	return { slug: storedBandSlug };
});

vi.mock('$lib/server/band/band-service', () => ({
	update: (...args: unknown[]) => updateBandBasics(...(args as [string, { name?: string }]))
}));
vi.mock('$lib/server/storage', () => ({ resolveImageUrl: (v: unknown) => v }));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));
// `db` is a bare object because this suite is about validation and slug
// behaviour, not reads. It carries a chainable `select` only so that
// `getMemberProfileEditor` — which now assembles the teaching card server-side —
// resolves instead of rejecting with "db.select is not a function". An
// unexpected read returns an empty result rather than throwing three frames away
// from the test that caused it.
function emptySelect(): unknown {
	const proxy: unknown = new Proxy(() => proxy, {
		get(_t, prop) {
			if (prop === 'then') return (resolve: (v: unknown[]) => void) => resolve([]);
			return () => proxy;
		}
	});
	return proxy;
}
vi.mock('$lib/server/db', () => ({ db: { select: () => emptySelect() } }));

/**
 * A faithful-enough `form()`: the real one runs the Zod schema before the
 * handler and never calls the handler on a validation failure. The default
 * pass-through mock used elsewhere in this suite skips validation entirely,
 * which is exactly the layer under test here.
 */
class ValidationFailure extends Error {
	constructor(readonly issues: z.core.$ZodIssue[]) {
		super('validation failed');
	}
}

/** Errors raised by post-write query refreshes (see the `query` mock below). */
const refreshFailures: unknown[] = [];

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: null },
		url: new URL('http://localhost/'),
		request: { headers: new Headers() }
	}),
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => unknown;
		// The forms call `getX().refresh()` after a successful write, so the call
		// result has to be a thenable carrying `.refresh`.
		//
		// `.refresh()` re-runs the query for real, because that is what the server
		// does: a refresh registers the query in `state.remote.refreshes`, and
		// `serialize_singleflight` awaits it while building the response. It also
		// *catches* a rejection per key and ships `{type:'error'}` to the client,
		// where `apply_refreshes` turns it into `resource.fail(new HttpError(...))`
		// — so a failed refresh does not reject the form, it poisons the query the
		// page is rendering. `refreshFailures` stands in for that error channel.
		const wrapped = (...a: unknown[]) => {
			const promise = Promise.resolve(handler(...a)) as Promise<unknown> & { refresh(): void };
			promise.refresh = () => {
				void Promise.resolve()
					.then(() => handler(...a))
					.catch((err) => refreshFailures.push(err));
			};
			return promise;
		};
		(wrapped as unknown as Record<string, unknown>).__ = { type: 'query' };
		return wrapped;
	},
	form: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) => {
		const fn = async (raw: unknown) => {
			const parsed = schema.safeParse(raw);
			if (!parsed.success) throw new ValidationFailure(parsed.error.issues);
			return handler(parsed.data);
		};
		const marked = fn as unknown as Record<string, unknown>;
		marked.__ = { type: 'form' };
		marked.for = () => fn;
		return fn;
	},
	command: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => unknown;
		(handler as unknown as Record<string, unknown>).__ = { type: 'command' };
		return handler;
	}
}));

const directory = (await import('./directory.remote')) as unknown as Record<
	string,
	(...args: unknown[]) => Promise<unknown>
>;

beforeEach(() => {
	vi.clearAllMocks();
	submittedSlug = 'the-regressions';
	storedBandSlug = 'the-regressions';
	refreshFailures.length = 0;
});

/** Let the queued `.refresh()` microtasks settle before asserting on them. */
const flush = () => new Promise((r) => setTimeout(r, 0));

const VALID_MEMBER = {
	tagline: '',
	bio: '',
	hometown: '',
	instruments: '["guitar","bass"]',
	genres: '["rock"]',
	lookingForBand: false,
	availableForHire: false,
	teachesLessons: false,
	openToCollaboration: false,
	directoryVisibility: 'members' as const,
	contactEmail: '',
	contactPhone: '',
	contactSocial: '',
	contactPublic: false,
	links: '[]'
};

const VALID_BAND = {
	slug: 'the-regressions',
	name: 'The Regressions',
	bio: '',
	tagline: '',
	hometown: '',
	foundedYear: '',
	genres: '["punk"]',
	lookingForMembers: false,
	directoryVisibility: 'public' as const,
	contactEmail: '',
	contactPhone: '',
	contactSocial: '',
	links: '[]'
};

describe('saveMemberProfile', () => {
	it('saves the decoded arrays on a well-formed submission', async () => {
		await directory.saveMemberProfile(VALID_MEMBER);

		expect(updateMemberProfile).toHaveBeenCalledWith(
			'user-1',
			expect.objectContaining({ instruments: ['guitar', 'bass'], genres: ['rock'] })
		);
	});

	for (const field of ['instruments', 'genres', 'links'] as const) {
		it(`rejects malformed ${field} instead of silently clearing it`, async () => {
			await expect(
				directory.saveMemberProfile({ ...VALID_MEMBER, [field]: 'not-json' })
			).rejects.toBeInstanceOf(ValidationFailure);

			// The bug: the handler ran with `[]` and wiped the stored value.
			expect(updateMemberProfile).not.toHaveBeenCalled();
		});
	}

	it('rejects a JSON scalar where an array is required', async () => {
		await expect(
			directory.saveMemberProfile({ ...VALID_MEMBER, instruments: '"guitar"' })
		).rejects.toBeInstanceOf(ValidationFailure);

		expect(updateMemberProfile).not.toHaveBeenCalled();
	});
});

describe('saveBandProfile', () => {
	it('saves the decoded arrays on a well-formed submission', async () => {
		await directory.saveBandProfile(VALID_BAND);

		expect(updateBandProfile).toHaveBeenCalledWith(
			'band-1',
			'user-1',
			expect.objectContaining({ genres: ['punk'] })
		);
	});

	for (const field of ['genres', 'links'] as const) {
		it(`rejects malformed ${field} instead of silently clearing it`, async () => {
			await expect(
				directory.saveBandProfile({ ...VALID_BAND, [field]: '{oops' })
			).rejects.toBeInstanceOf(ValidationFailure);

			expect(updateBandProfile).not.toHaveBeenCalled();
		});
	}

	// Regression, fixed at the source: renaming a band used to rotate its slug,
	// while the post-write `getBandProfileEditor(slug).refresh()` re-resolves the
	// band through `requireGroupRole({ slug })` — and that slug is still the OLD
	// one, because it came off the form the client submitted before the rename.
	// The lookup missed and threw 404, so the save succeeded but the page's
	// profile query was left in a failed state. `update()` no longer derives the
	// slug from the name, so the refresh is unconditional and the hazard is gone.
	it('leaves the slug alone when the name changes, so the refresh still resolves', async () => {
		const result = await directory.saveBandProfile({
			...VALID_BAND,
			name: 'Brand New Name'
		});

		await flush();

		expect(result).toEqual({ success: true });
		expect(storedBandSlug).toBe('the-regressions');
		expect(refreshFailures).toEqual([]);
	});

	it('still refreshes the profile query when the name is unchanged', async () => {
		await directory.saveBandProfile(VALID_BAND);
		await flush();

		expect(storedBandSlug).toBe('the-regressions');
		expect(refreshFailures).toEqual([]);
	});
});
