import { describe, it, expect, vi, beforeEach } from 'vitest';
import { positionOrder, type Capability, type Position } from '$lib/config';

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
let heldPositions: Position[] = ['staff'];
const requested: string[] = [];

// Simulated against the real matrix, so the table below shows what the
// positions actually grant.
vi.mock('$lib/server/authorization', async () => {
	const config = await import('$lib/config');
	const holds = (cap: Capability) =>
		heldPositions.some((p) => config.grantsCapability(config.positions[p], cap));
	return {
		can: async (cap: Capability) => currentUser !== null && holds(cap),
		requireCapability: async (cap: Capability) => {
			requested.push(cap);
			if (!currentUser) throw new Error('401: Not authenticated');
			if (!holds(cap)) throw new Error('403: Not permitted');
			return currentUser;
		}
	};
});

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
	setRadioExclusion: vi.fn(async () => ({ id: 'rel-1' })),
	recentSales: vi.fn(async () => [])
};
vi.mock('$lib/server/audio/staff-audio-service', () => svc);

const radio = {
	getRadioNow: vi.fn(async () => ({ serverNow: new Date(), current: null, upNext: [] })),
	getRecentlyPlayed: vi.fn(async () => [])
};
vi.mock('$lib/server/audio/radio-service', () => radio);

const purchases = { refundPurchase: vi.fn(async () => undefined) };
vi.mock('$lib/server/audio/purchase-service', () => purchases);

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
	['setRadioExclusionForm', { releaseId: 'rel-1', excluded: true }],
	// The one that moves money, and out of a band's account as well as CMC's.
	['refundPurchaseForm', { purchaseId: 'p-1' }]
];

function noWrites() {
	expect(svc.withholdRelease).not.toHaveBeenCalled();
	expect(svc.restoreRelease).not.toHaveBeenCalled();
	expect(svc.setRadioExclusion).not.toHaveBeenCalled();
	expect(purchases.refundPurchase).not.toHaveBeenCalled();
}

beforeEach(() => {
	vi.clearAllMocks();
	currentUser = { id: 'u-staff' };
	heldPositions = ['staff'];
	requested.length = 0;
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

	it('rejects a signed-in member who holds no position', async () => {
		// Nothing here is band-scoped: an ordinary member reaching this would be
		// reading every band's sales and able to take any record down.
		heldPositions = [];
		await expect(remote.getStaffMusicPage()).rejects.toThrow(/403/);
		for (const [name, payload] of MUTATIONS) {
			await expect(remote[name](payload), name).rejects.toThrow(/403/);
		}
		expect(svc.listAllReleases).not.toHaveBeenCalled();
		noWrites();
	});
});

describe('staff music — capabilities', () => {
	const EXPORTS: Array<[string, unknown, Capability]> = [
		['getStaffMusicPage', undefined, 'music.read'],
		['withholdReleaseForm', MUTATIONS[0][1], 'music.moderate'],
		['restoreReleaseForm', MUTATIONS[1][1], 'music.moderate'],
		['setRadioExclusionForm', MUTATIONS[2][1], 'music.moderate'],
		['refundPurchaseForm', MUTATIONS[3][1], 'finance.refund']
	];

	// First, because a form's `refresh()` re-runs the page query behind it.
	it.each(EXPORTS.map(([n, p, c]) => [n, c, p] as const))(
		'%s names %s first',
		async (name, cap, payload) => {
			await remote[name](payload);
			expect(requested[0]).toBe(cap);
		}
	);

	it('refuses a technology coordinator everything, writing nothing', async () => {
		heldPositions = ['technology_coordinator'];
		for (const [name, payload] of EXPORTS) {
			await expect(remote[name](payload), name).rejects.toThrow(/403/);
		}
		noWrites();
	});

	it('lets a treasurer read and refund, but not take a release down', async () => {
		heldPositions = ['treasurer'];
		await remote.getStaffMusicPage();
		await remote.refundPurchaseForm({ purchaseId: 'p-1' });
		await expect(remote.withholdReleaseForm(MUTATIONS[0][1])).rejects.toThrow(/403/);
		expect(svc.withholdRelease).not.toHaveBeenCalled();
	});

	it('lets a site moderator read and take down, but not refund', async () => {
		heldPositions = ['site_moderator'];
		await remote.getStaffMusicPage();
		await remote.withholdReleaseForm(MUTATIONS[0][1]);
		await expect(remote.refundPurchaseForm({ purchaseId: 'p-1' })).rejects.toThrow(/403/);
		expect(purchases.refundPurchase).not.toHaveBeenCalled();
	});

	// Before: `requireStaff`, so any position passed every export. After: the
	// matrix #1391 settles on. Every combination of the six, including none.
	it('admits exactly the intended holders of each export', async () => {
		const subsets = Array.from({ length: 2 ** positionOrder.length }, (_, mask) =>
			positionOrder.filter((_, i) => mask & (1 << i))
		);
		const intended: Record<Capability, Position[]> = {
			'music.read': ['admin', 'staff', 'site_moderator', 'treasurer'],
			'music.moderate': ['admin', 'staff', 'site_moderator'],
			'finance.refund': ['admin', 'staff', 'treasurer']
		} as Record<Capability, Position[]>;
		for (const held of subsets) {
			heldPositions = held;
			for (const [name, payload, cap] of EXPORTS) {
				const allowed = await remote[name](payload).then(
					() => true,
					() => false
				);
				const label = `${held.join('+') || '(none)'} ${name}`;
				expect(allowed, label).toBe(held.some((p) => intended[cap].includes(p)));
			}
		}
	});

	it('tells the page which controls to offer', async () => {
		heldPositions = ['treasurer'];
		expect(await remote.getStaffMusicPage()).toMatchObject({
			canModerate: false,
			canRefund: true
		});
		heldPositions = ['site_moderator'];
		expect(await remote.getStaffMusicPage()).toMatchObject({
			canModerate: true,
			canRefund: false
		});
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

describe('staff music — refunds', () => {
	it('passes the purchase through to the service', async () => {
		await remote.refundPurchaseForm({ purchaseId: 'p-1' });
		expect(purchases.refundPurchase).toHaveBeenCalledWith('p-1');
	});

	it('refunds while the flag is off', async () => {
		// A refund request does not wait for a launch decision — and staff reach
		// this page precisely when the storefront is not switched on.
		isFeatureEnabled.mockResolvedValue(false);
		await remote.refundPurchaseForm({ purchaseId: 'p-1' });
		expect(purchases.refundPurchase).toHaveBeenCalledWith('p-1');
	});
});
