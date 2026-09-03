import { describe, it, expect, vi, beforeEach } from 'vitest';

// Remote functions are directly addressable endpoints: SvelteKit dispatches a
// remote call before any route load runs, so these are only as guarded as their
// own first line. There is no +layout.server.ts under /band to fall back on, and
// the slug these take arrives in a client-supplied header.
//
// Two things are pinned here. Every endpoint rejects the wrong caller *before
// touching the database*. And — the one specific to this module — no endpoint
// can be steered at another band's release by pairing a slug the caller does own
// with a release id they do not.

let currentRole: 'owner' | 'admin' | 'member' | 'staff' | null = 'admin';
let featureOn = true;

/** The band the caller passed a slug for. */
const BAND = { id: 'band-1', slug: 'sour-cherry', name: 'Sour Cherry' };

vi.mock('$lib/server/feature-flags', () => ({
	requireFeature: async () => {
		if (!featureOn) throw new Error('404: Not found');
	}
}));

vi.mock('$lib/server/group/group-context', () => ({
	requireGroupRole: async (
		ref: { slug?: string },
		minRole: 'owner' | 'admin' | 'member',
		opts?: { allowStaff?: boolean }
	) => {
		if (!currentRole) throw new Error('401: Not authenticated');
		if (currentRole === 'staff' && !opts?.allowStaff) throw new Error('403: Not a member');

		const rank = { owner: 0, admin: 1, member: 2, staff: 1 } as const;
		if (rank[currentRole] > rank[minRole]) throw new Error('403: Insufficient role');
		// The guard resolves the group from the ref it was handed; a bad slug is a
		// 404 here just as it is in the real one.
		if (ref.slug !== BAND.slug) throw new Error('404: Band not found');
		return { user: { id: 'u-1' }, group: BAND, role: currentRole };
	}
}));

// Any service call on a rejected request is itself the failure — the guard has
// to run first, so these spies must stay clean.
const svc = {
	listReleasesForBand: vi.fn(async () => []),
	listTracks: vi.fn(async () => [{ id: 'track-1' }] as unknown[]),
	getReleaseById: vi.fn(async () => ({ id: 'rel-1', groupId: BAND.id }) as unknown),
	createRelease: vi.fn(async () => ({ id: 'rel-new' })),
	updateRelease: vi.fn(async () => ({ id: 'rel-1' })),
	publishRelease: vi.fn(async () => ({ id: 'rel-1' })),
	unpublishRelease: vi.fn(async () => ({ id: 'rel-1' })),
	deleteRelease: vi.fn(async () => 'deleted' as const),
	addTrack: vi.fn(async () => ({ id: 'track-1' })),
	renameTrack: vi.fn(async () => ({ id: 'track-1' })),
	deleteTrack: vi.fn(async () => undefined),
	reorderTracks: vi.fn(async () => undefined)
};
vi.mock('$lib/server/audio/audio-service', () => svc);

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: { id: 'u-1' } },
		params: {},
		url: new URL('http://localhost/'),
		request: { headers: new Headers() }
	}),
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => Promise<unknown>;
		const wrapped = (...a: unknown[]) => {
			const promise = handler(...a) as Promise<unknown> & { refresh?: () => void };
			promise.refresh = () => undefined;
			return promise;
		};
		// SvelteKit validates every export of a .remote.ts at import time, so the
		// stubs have to carry the same marker the real helpers attach.
		(wrapped as unknown as Record<string, unknown>).__ = { type: 'query' };
		return wrapped;
	},
	form: (_schema: unknown, handler: (...a: unknown[]) => unknown) => {
		const fn = handler as unknown as Record<string, unknown>;
		fn.__ = { type: 'form' };
		fn.for = () => fn;
		return handler;
	},
	command: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => unknown;
		(handler as unknown as Record<string, unknown>).__ = { type: 'command' };
		return handler;
	}
}));

const remote = (await import('./audio.remote')) as unknown as Record<
	string,
	(...args: unknown[]) => Promise<unknown>
>;

/** Every mutation, with a payload good enough to reach the guard. */
const MUTATIONS: Array<[name: string, payload: Record<string, unknown>]> = [
	['createReleaseForm', { slug: BAND.slug, title: 'Alsea', kind: 'ep' }],
	['updateReleaseForm', { slug: BAND.slug, releaseId: 'rel-1', title: 'Alsea', kind: 'ep' }],
	['setRadioOptInForm', { slug: BAND.slug, releaseId: 'rel-1', radioOptIn: true }],
	['publishReleaseForm', { slug: BAND.slug, releaseId: 'rel-1' }],
	['unpublishReleaseForm', { slug: BAND.slug, releaseId: 'rel-1' }],
	['deleteReleaseForm', { slug: BAND.slug, releaseId: 'rel-1' }],
	['renameTrackForm', { slug: BAND.slug, releaseId: 'rel-1', trackId: 'track-1', title: 'X' }],
	['deleteTrackForm', { slug: BAND.slug, releaseId: 'rel-1', trackId: 'track-1' }],
	['reorderTracksCommand', { slug: BAND.slug, releaseId: 'rel-1', trackIds: ['track-1'] }]
];

/**
 * Assert a rejection carries a given HTTP status.
 *
 * Two shapes reach here and `toThrow(/404/)` only matches one. The guards this
 * spec mocks throw plain `Error('401: …')`, while `error()` from SvelteKit
 * throws an `HttpError` — an object with a `status`, whose message is empty. A
 * regex over the message silently passes on the second kind, which is exactly
 * the kind the cross-band checks produce.
 */
async function rejectsWith(promise: Promise<unknown>, status: number, label?: string) {
	const err = await promise.then(
		() => null,
		(e: unknown) => e ?? new Error('rejected with no value')
	);
	expect(err, `${label ?? 'call'} should have rejected`).not.toBeNull();
	const fromMessage = Number(/^(\d{3})/.exec(String((err as Error)?.message ?? ''))?.[1]);
	const actual = (err as { status?: number })?.status ?? fromMessage;
	expect(actual, label).toBe(status);
}

function noServiceWrites() {
	expect(svc.createRelease).not.toHaveBeenCalled();
	expect(svc.updateRelease).not.toHaveBeenCalled();
	expect(svc.publishRelease).not.toHaveBeenCalled();
	expect(svc.unpublishRelease).not.toHaveBeenCalled();
	expect(svc.deleteRelease).not.toHaveBeenCalled();
	expect(svc.renameTrack).not.toHaveBeenCalled();
	expect(svc.deleteTrack).not.toHaveBeenCalled();
	expect(svc.reorderTracks).not.toHaveBeenCalled();
}

beforeEach(() => {
	vi.clearAllMocks();
	currentRole = 'admin';
	featureOn = true;
	svc.getReleaseById.mockResolvedValue({ id: 'rel-1', groupId: BAND.id } as never);
	svc.listTracks.mockResolvedValue([{ id: 'track-1' }] as never);
});

describe('audio remote — authentication', () => {
	it('rejects every mutation from a signed-out caller, before any write', async () => {
		currentRole = null;
		for (const [name, payload] of MUTATIONS) {
			await rejectsWith(remote[name](payload), 401, name);
		}
		noServiceWrites();
	});

	it('rejects both queries from a signed-out caller', async () => {
		currentRole = null;
		await rejectsWith(remote.getBandMusicPage(BAND.slug), 401);
		await rejectsWith(remote.getBandRelease({ slug: BAND.slug, releaseId: 'rel-1' }), 401);
		expect(svc.listReleasesForBand).not.toHaveBeenCalled();
		expect(svc.listTracks).not.toHaveBeenCalled();
	});
});

describe('audio remote — role', () => {
	// The split the panel depends on: the whole band can read the discography,
	// only owners and admins can change it. A member who could publish would be
	// publishing on the band's behalf.
	it('lets a plain member read but not write', async () => {
		currentRole = 'member';
		await expect(remote.getBandMusicPage(BAND.slug)).resolves.toBeDefined();

		for (const [name, payload] of MUTATIONS) {
			await rejectsWith(remote[name](payload), 403, name);
		}
		noServiceWrites();
	});

	it('reports canManage as false for that member, so the page hides the controls', async () => {
		currentRole = 'member';
		const page = (await remote.getBandMusicPage(BAND.slug)) as { canManage: boolean };
		expect(page.canManage).toBe(false);
	});

	it('lets an admin write', async () => {
		currentRole = 'admin';
		await expect(
			remote.publishReleaseForm({ slug: BAND.slug, releaseId: 'rel-1' })
		).resolves.toBeDefined();
		expect(svc.publishRelease).toHaveBeenCalledWith('rel-1');
	});

	it('lets staff in, which is what makes the moderation path work', async () => {
		currentRole = 'staff';
		const page = (await remote.getBandMusicPage(BAND.slug)) as { canManage: boolean };
		expect(page.canManage).toBe(true);
	});
});

describe('audio remote — the feature flag', () => {
	// The flag is the launch switch, so it has to gate reads and writes alike. A
	// flag that only hid the nav row would leave every endpoint live.
	it('404s everything while bandAudio is off', async () => {
		featureOn = false;
		await rejectsWith(remote.getBandMusicPage(BAND.slug), 404);
		for (const [name, payload] of MUTATIONS) {
			await rejectsWith(remote[name](payload), 404, name);
		}
		noServiceWrites();
	});
});

describe('audio remote — cross-band access', () => {
	// The attack the guard shape exists to stop: the caller is a genuine admin of
	// the band whose slug they pass, and supplies a release id belonging to
	// someone else. Resolving the band *from the release* would let this through,
	// because the release's own band would always match itself.
	it('refuses a release that belongs to another band', async () => {
		svc.getReleaseById.mockResolvedValue({ id: 'rel-x', groupId: 'band-2' } as never);

		for (const [name, payload] of MUTATIONS) {
			if (name === 'createReleaseForm') continue; // no release id to mismatch
			await rejectsWith(remote[name](payload), 404, name);
		}
		noServiceWrites();
	});

	it('refuses a track that belongs to another release of the same band', async () => {
		// `requireReleaseAdmin` proves the caller may edit *this* release; without
		// the second check a valid admin could rename any track id in the database.
		svc.listTracks.mockResolvedValue([{ id: 'track-1' }] as never);
		await rejectsWith(
			remote.renameTrackForm({
				slug: BAND.slug,
				releaseId: 'rel-1',
				trackId: 'track-from-elsewhere',
				title: 'X'
			}),
			404
		);
		expect(svc.renameTrack).not.toHaveBeenCalled();
	});

	it('refuses a slug the caller has no role on', async () => {
		await rejectsWith(remote.getBandMusicPage('some-other-band'), 404);
		expect(svc.listReleasesForBand).not.toHaveBeenCalled();
	});
});

describe('audio remote — release dates', () => {
	// The date field is a plain string precisely because a `.transform()` in a
	// `form()` schema breaks the `fields` inference `<Form>` needs, so the
	// conversion happens in the handler and is worth pinning.
	it('stores a cleared date as null rather than an Invalid Date', async () => {
		await remote.createReleaseForm({
			slug: BAND.slug,
			title: 'Demos',
			kind: 'demo',
			releasedAt: ''
		});
		expect(svc.createRelease).toHaveBeenCalledWith(expect.objectContaining({ releasedAt: null }));
	});

	it('stores a supplied date at midday, so it does not read as the day before in Oregon', async () => {
		await remote.createReleaseForm({
			slug: BAND.slug,
			title: 'Alsea',
			kind: 'ep',
			releasedAt: '2026-03-14'
		});
		// `createRelease` is declared as taking no args in the spy above, so the
		// recorded call has to be widened to be read.
		const call = svc.createRelease.mock.calls[0] as unknown as [{ releasedAt: Date }];
		const { releasedAt } = call[0];
		expect(releasedAt.toISOString()).toBe('2026-03-14T12:00:00.000Z');
	});
});
