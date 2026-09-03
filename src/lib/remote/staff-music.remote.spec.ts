import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Staff music tools are a moderation surface over every band's records, so the
 * guard is the whole story: nothing here is scoped to a band the caller belongs
 * to, and a remote function is only as guarded as its own first line.
 *
 * The second thing pinned is the deliberate *absence* of a flag check. The
 * `cmcRadio` toggle gates on "is there enough music yet", and this page is where
 * that is answered — putting it behind the flag would mean switching the station
 * on to find out whether to switch it on.
 */

let currentUser: { id: string } | null = { id: 'u-staff' };
let isStaff = true;

vi.mock('$lib/server/authorization', () => ({
	requireStaff: async () => {
		if (!currentUser) throw new Error('401: Not authenticated');
		if (!isStaff) throw new Error('403: Staff access required');
		return currentUser;
	}
}));

// Every flag reads true here, so a spec that passes cannot be passing *because*
// something was switched off.
const isFeatureEnabled = vi.fn(async () => true);
vi.mock('$lib/server/feature-flags', () => ({ isFeatureEnabled }));

const svc = {
	listAllReleases: vi.fn(async () => []),
	radioPoolStats: vi.fn(async () => ({
		eligibleTracks: 0,
		bands: 0,
		optedInReleases: 0,
		excludedByLength: 0
	})),
	salesTotals: vi.fn(async () => ({
		sales: 0,
		freeSales: 0,
		grossCents: 0,
		toBandsCents: 0,
		toCollectiveCents: 0,
		realisedTakeBps: 0
	})),
	withholdRelease: vi.fn(async () => ({ id: 'rel-1' })),
	restoreRelease: vi.fn(async () => ({ id: 'rel-1' })),
	setRadioExclusion: vi.fn(async () => ({ id: 'rel-1' }))
};
vi.mock('$lib/server/audio/staff-audio-service', () => svc);

const radio = {
	getRadioNow: vi.fn(async () => ({ serverNow: new Date(), current: null, upNext: [] })),
	getRecentlyPlayed: vi.fn(async () => [])
};
vi.mock('$lib/server/audio/radio-service', () => radio);

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: { user: currentUser }, params: {}, url: new URL('http://x/') }),
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => Promise<unknown>;
		const wrapped = (...a: unknown[]) => {
			const promise = handler(...a) as Promise<unknown> & { refresh?: () => void };
			promise.refresh = () => undefined;
			return promise;
		};
		(wrapped as unknown as Record<string, unknown>).__ = { type: 'query' };
		return wrapped;
	},
	form: (_schema: unknown, handler: (...a: unknown[]) => unknown) => {
		const fn = handler as unknown as Record<string, unknown>;
		fn.__ = { type: 'form' };
		fn.for = () => fn;
		return handler;
	}
}));

const remote = (await import('./staff-music.remote')) as unknown as Record<
	string,
	(...args: unknown[]) => Promise<unknown>
>;

const MUTATIONS: Array<[string, Record<string, unknown>]> = [
	['withholdReleaseForm', { releaseId: 'rel-1', reason: 'Uncleared sample' }],
	['restoreReleaseForm', { releaseId: 'rel-1' }],
	['setRadioExclusionForm', { releaseId: 'rel-1', excluded: true }]
];

function noWrites() {
	expect(svc.withholdRelease).not.toHaveBeenCalled();
	expect(svc.restoreRelease).not.toHaveBeenCalled();
	expect(svc.setRadioExclusion).not.toHaveBeenCalled();
}

beforeEach(() => {
	vi.clearAllMocks();
	currentUser = { id: 'u-staff' };
	isStaff = true;
	isFeatureEnabled.mockResolvedValue(true);
});

describe('staff music — guards', () => {
	it('rejects a signed-out caller before reading anything', async () => {
		currentUser = null;
		await expect(remote.getStaffMusicPage()).rejects.toThrow(/401/);
		for (const [name, payload] of MUTATIONS) {
			await expect(remote[name](payload), name).rejects.toThrow(/401/);
		}
		expect(svc.listAllReleases).not.toHaveBeenCalled();
		noWrites();
	});

	it('rejects a signed-in non-staff member', async () => {
		// Nothing here is band-scoped: an ordinary member reaching this would be
		// reading every band's sales and able to take any record down.
		isStaff = false;
		await expect(remote.getStaffMusicPage()).rejects.toThrow(/403/);
		for (const [name, payload] of MUTATIONS) {
			await expect(remote[name](payload), name).rejects.toThrow(/403/);
		}
		expect(svc.listAllReleases).not.toHaveBeenCalled();
		noWrites();
	});
});

describe('staff music — the flag', () => {
	it('still works with both flags off, which is the point of it', async () => {
		// The toggle gates on "is there enough music yet". A page behind that
		// toggle could not answer it.
		isFeatureEnabled.mockResolvedValue(false);

		const page = (await remote.getStaffMusicPage()) as {
			radioEnabled: boolean;
			audioEnabled: boolean;
		};
		expect(page.radioEnabled).toBe(false);
		expect(page.audioEnabled).toBe(false);
		// And it read the pool anyway — that is the number staff came for.
		expect(svc.radioPoolStats).toHaveBeenCalled();
	});

	it('reports both flags so the page can say which is off', async () => {
		const page = (await remote.getStaffMusicPage()) as {
			radioEnabled: boolean;
			audioEnabled: boolean;
		};
		expect(page).toMatchObject({ radioEnabled: true, audioEnabled: true });
	});
});

describe('staff music — moderation', () => {
	it('requires a reason to withhold, because the band is shown it', async () => {
		// A takedown a band cannot see the cause of is one they cannot fix.
		await remote.withholdReleaseForm({ releaseId: 'rel-1', reason: 'Uncleared sample' });
		expect(svc.withholdRelease).toHaveBeenCalledWith('rel-1', 'Uncleared sample');
	});

	it('restores to draft — the band decides whether to publish again', async () => {
		await remote.restoreReleaseForm({ releaseId: 'rel-1' });
		expect(svc.restoreRelease).toHaveBeenCalledWith('rel-1');
	});

	it('passes the exclusion through in both directions', async () => {
		await remote.setRadioExclusionForm({ releaseId: 'rel-1', excluded: true, reason: 'Sample' });
		expect(svc.setRadioExclusion).toHaveBeenCalledWith('rel-1', true, 'Sample');

		await remote.setRadioExclusionForm({ releaseId: 'rel-1', excluded: false });
		expect(svc.setRadioExclusion).toHaveBeenLastCalledWith('rel-1', false, undefined);

		// The *absent* case — an unchecked checkbox posts nothing at all — is
		// handled by `.optional().default(false)` in the schema, and is
		// deliberately not asserted here: the `form()` stub these specs share
		// calls the handler directly and never runs Zod, so a test for it would
		// be measuring the stub. `kit_form_boolean_check` is the reason the field
		// is written that way; a required boolean rejects the whole submission
		// with an error naming a field the user cannot see.
	});
});
