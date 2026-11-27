import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Every band member reads the band's profile and press kit; only an owner or
 * admin writes them (#3127). The reads drop to `member` and report `canEdit`;
 * the writes keep their `admin` guard. The guard below enforces the real role
 * order, so a write that lost its `admin` would let the plain member through.
 */

const state = vi.hoisted(() => ({ role: 'member' as 'owner' | 'admin' | 'member' }));

const guard = vi.hoisted(() =>
	vi.fn(async (_ref: unknown, minRole: 'owner' | 'admin' | 'member') => {
		const rank = { owner: 0, admin: 1, member: 2 } as const;
		if (rank[state.role] > rank[minRole]) throw new Error('forbidden');
		return {
			user: { id: 'u1' },
			group: { id: 'b1', slug: 'saltmarsh', kind: 'band', name: 'Saltmarsh Radio' },
			role: state.role
		};
	})
);

const { chain } = vi.hoisted(() => {
	const chain: Record<string, unknown> = {};
	for (const m of ['from', 'innerJoin', 'leftJoin', 'where', 'groupBy', 'orderBy', 'limit']) {
		chain[m] = () => chain;
	}
	chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve([]).then(resolve);
	return { chain };
});

vi.mock('$app/server', () => {
	const wrap =
		(type: string) =>
		(...args: unknown[]) => {
			const fn = (typeof args[0] === 'function' ? args[0] : args[1]) as (...a: never[]) => unknown;
			Object.assign(fn, { __: { type }, for: () => fn });
			return fn;
		};
	return {
		query: wrap('query'),
		form: wrap('form'),
		command: wrap('command'),
		getRequestEvent: () => ({ locals: {} })
	};
});
vi.mock('#lib/server/db/index.js', () => ({ db: { select: () => chain, query: {} } }));
vi.mock('#lib/server/group/group-context.js', () => ({
	requireGroupRole: guard,
	requireBandRole: guard
}));
vi.mock('#lib/server/authorization.js', () => ({
	requireUser: () => ({ id: 'u1' }),
	requireStaff: vi.fn(),
	requireCapability: vi.fn()
}));
vi.mock('#lib/server/storage.js', () => ({ resolveImageUrl: (k: string | null) => k }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('#lib/server/media/media-service.js', () => ({
	listFor: vi.fn(async () => []),
	descriptionUpdate: vi.fn()
}));
vi.mock('#lib/server/event/event-service.js', async (importOriginal) => ({
	...(await importOriginal<object>()),
	listBandEventsUpcoming: vi.fn(async () => [])
}));
const updateBandProfile = vi.fn();
vi.mock('#lib/server/directory/profile-service.js', async (importOriginal) => ({
	...(await importOriginal<object>()),
	getBandProfileForEdit: vi.fn(async () => ({ tagline: 'Loud' })),
	updateBandProfile
}));
vi.mock('#lib/server/directory/directory-service.js', async (importOriginal) => ({
	...(await importOriginal<object>()),
	suggestInstruments: vi.fn(async () => []),
	suggestGenres: vi.fn(async () => [])
}));
const savePressKit = vi.fn();
vi.mock('#lib/server/band/band-site-service.js', async (importOriginal) => ({
	...(await importOriginal<object>()),
	savePressKit
}));

const { getBandProfileEditor, saveBandProfile } = (await import('./directory.remote')) as any;
const { getPressKitEditor, saveBandEpk } = (await import('./press-kit.remote')) as any;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('a plain member', () => {
	beforeEach(() => {
		state.role = 'member';
	});

	it('gets the read view of the profile and the press kit', async () => {
		expect((await getBandProfileEditor('saltmarsh')).canEdit).toBe(false);
		expect((await getPressKitEditor('saltmarsh')).canEdit).toBe(false);
	});

	it('is refused on a profile save, before anything is written', async () => {
		await expect(saveBandProfile({ slug: 'saltmarsh', name: 'Renamed' })).rejects.toThrow(
			'forbidden'
		);
		expect(updateBandProfile).not.toHaveBeenCalled();
	});

	it('is refused on a press kit save, before anything is written', async () => {
		await expect(saveBandEpk({ slug: 'saltmarsh', epk: {} })).rejects.toThrow('forbidden');
		expect(savePressKit).not.toHaveBeenCalled();
	});
});

describe('an admin', () => {
	it('gets the edit view of both', async () => {
		state.role = 'admin';
		expect((await getBandProfileEditor('saltmarsh')).canEdit).toBe(true);
		expect((await getPressKitEditor('saltmarsh')).canEdit).toBe(true);
	});
});
