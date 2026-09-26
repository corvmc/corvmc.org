import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

/**
 * The market remotes' two boundaries: the public form checks Turnstile before
 * anything is filed, and every staff export names `event.manage`.
 */

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		request: new Request('http://x/'),
		url: new URL('https://corvmc.org/market/pay/v-1'),
		locals: {}
	}),
	query: (schema: z.ZodType, handler: (a: unknown) => unknown) =>
		// Lazy, like kit's: a query that is only refreshed never runs its handler.
		Object.assign(
			(raw: unknown) => ({
				refresh: async () => {},
				then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) =>
					Promise.resolve()
						.then(() => handler(schema.parse(raw)))
						.then(ok, fail)
			}),
			{ __: { type: 'query' } }
		),
	form: (schema: z.ZodType, handler: (d: unknown, issue: unknown) => unknown) =>
		Object.assign(
			async (raw: unknown) =>
				handler(schema.parse(raw), new Proxy({}, { get: () => (msg: string) => msg })),
			{ __: { type: 'form' } }
		)
}));

vi.mock('@sveltejs/kit', async (importOriginal) => ({
	...(await importOriginal<typeof import('@sveltejs/kit')>()),
	invalid: (msg: unknown) => {
		throw new Error(`invalid: ${String(msg)}`);
	}
}));

const turnstileOk = vi.fn(async () => true);
vi.mock('$lib/server/turnstile', () => ({ verifyTurnstile: () => turnstileOk() }));

let signedIn = false;
const requested: string[] = [];
vi.mock('$lib/server/authorization', async () => {
	const { error } = await import('@sveltejs/kit');
	return {
		requireCapability: async (cap: string) => {
			requested.push(cap);
			if (!signedIn) throw error(401, 'Not authenticated');
			return { id: 'staff-1', name: 'Sam Staff' };
		}
	};
});

// A fake committee guard over the fake capability check above: members of
// `committeeOf` pass, anyone else falls through to the staff cover.
let committeeOf: string[] = [];
const guardedOn: [string | null, string][] = [];
vi.mock('$lib/server/group/group-context', async () => {
	const { error } = await import('@sveltejs/kit');
	return {
		requireCommitteeMember: async (groupId: string | null, cover: string) => {
			guardedOn.push([groupId, cover]);
			if (groupId && committeeOf.includes(groupId)) {
				return { user: { id: 'member-1', name: 'Casey Committee' }, group: null, role: 'member' };
			}
			requested.push(cover);
			if (!signedIn) throw error(401, 'Not authenticated');
			if (!staff) throw error(403, 'Not a member of the committee that owns this');
			return { user: { id: 'staff-1', name: 'Sam Staff' }, group: null, role: 'staff' };
		},
		// Keyed by project: `committeeOf` names the projects the caller's committee is on.
		requireProjectCommittee: async (projectId: string | null, cover: string) => {
			guardedOn.push([projectId, cover]);
			if (projectId && committeeOf.includes(projectId)) {
				return { user: { id: 'member-1', name: 'Casey Committee' }, groups: [], via: 'committee' };
			}
			requested.push(cover);
			if (!signedIn) throw error(401, 'Not authenticated');
			if (!staff) throw error(403, 'Not on a committee taking part in this project');
			return { user: { id: 'staff-1', name: 'Sam Staff' }, groups: [], via: 'staff' };
		}
	};
});
let staff = true;

const svc = vi.hoisted(() => ({
	decideApplication: vi.fn(async () => ({ eventId: 'evt-1' })),
	getApplicationWindow: vi.fn(async () => null),
	getMarketDay: vi.fn(async () => null),
	getMarketEvent: vi.fn(async () => ({ id: 'evt-1' })),
	listApplications: vi.fn(async () => []),
	listPublicVendors: vi.fn(async () => []),
	openMarketDay: vi.fn(async () => undefined),
	setTableLabel: vi.fn(async () => ({ eventId: 'evt-1' })),
	submitApplication: vi.fn(async () => ({ id: 'v-1' })),
	withdrawApplication: vi.fn(async () => ({ eventId: 'evt-1' })),
	getMarketProjectId: vi.fn(async () => 'proj-dev'),
	getVendorEventId: vi.fn(async () => 'evt-1'),
	listCommitteeMarkets: vi.fn(async () => [])
}));
vi.mock('$lib/server/market/market-service', () => svc);

const fees = vi.hoisted(() => ({
	getVendorFee: vi.fn(async (): Promise<unknown> => null),
	startVendorFeeCheckout: vi.fn(async () => ({ checkoutUrl: '/checkout/cs_1' }))
}));
vi.mock('$lib/server/market/vendor-fee-service', () => fees);

const remote = await import('./market.remote');

/** The mocked `form()` above returns a plain function; the real type has no call signature. */
const submit = (f: unknown, data: unknown) => (f as (d: unknown) => Promise<unknown>)(data);

const application = {
	eventId: 'evt-1',
	contactName: 'Rosa Diaz',
	contactEmail: 'rosa@example.com',
	businessName: 'Rosa Ceramics',
	offering: 'Mugs',
	tablesRequested: 1,
	turnstileToken: 'tok'
};

beforeEach(() => {
	signedIn = false;
	staff = true;
	committeeOf = [];
	requested.length = 0;
	guardedOn.length = 0;
	vi.clearAllMocks();
	turnstileOk.mockResolvedValue(true);
});

describe('the public application form', () => {
	it('files the application once Turnstile passes', async () => {
		await submit(remote.submitVendorApplicationForm, application);
		expect(svc.submitApplication).toHaveBeenCalledWith(
			'evt-1',
			expect.objectContaining({ businessName: 'Rosa Ceramics', needsPower: false })
		);
	});

	it('files nothing when Turnstile fails', async () => {
		turnstileOk.mockResolvedValue(false);
		await expect(submit(remote.submitVendorApplicationForm, application)).rejects.toThrow(
			/invalid/
		);
		expect(svc.submitApplication).not.toHaveBeenCalled();
	});

	it('refuses more tables than one vendor may ask for', async () => {
		await expect(
			submit(remote.submitVendorApplicationForm, { ...application, tablesRequested: 9 })
		).rejects.toThrow();
	});
});

describe('staff exports', () => {
	const calls: [string, () => Promise<unknown>][] = [
		['getStaffMarketVendors', () => remote.getStaffMarketVendors('evt-1')],
		['openMarketDayForm', () => submit(remote.openMarketDayForm, { eventId: 'evt-1' })],
		['setTableLabelForm', () => submit(remote.setTableLabelForm, { vendorId: 'v-1' })],
		['withdrawVendorForm', () => submit(remote.withdrawVendorForm, { vendorId: 'v-1' })]
	];

	for (const [name, call] of calls) {
		it(`${name} refuses an anonymous caller on event.manage`, async () => {
			await expect(call()).rejects.toMatchObject({ status: 401 });
			expect(requested).toEqual(['event.manage']);
		});
	}
});

describe('deciding an application (#1503)', () => {
	const decide = (decision = 'accepted') =>
		submit(remote.decideVendorForm, { vendorId: 'v-1', decision, message: 'In' });

	it("guards on the committees on the vendor's market's project, with event.manage as cover", async () => {
		committeeOf = ['grp-dev', 'proj-dev'];
		await decide();
		expect(svc.getVendorEventId).toHaveBeenCalledWith('v-1');
		expect(svc.getMarketProjectId).toHaveBeenCalledWith('evt-1');
		expect(guardedOn).toEqual([['proj-dev', 'event.manage']]);
	});

	it.each(['accepted', 'declined'])(
		'lets a member of the owning committee record %s, as themselves',
		async (decision) => {
			committeeOf = ['grp-dev', 'proj-dev'];
			await decide(decision);
			expect(svc.decideApplication).toHaveBeenCalledWith(
				'v-1',
				expect.objectContaining({ decision }),
				{ id: 'member-1', name: 'Casey Committee' }
			);
		}
	);

	it('lets staff decide as cover', async () => {
		signedIn = true;
		await decide();
		expect(svc.decideApplication).toHaveBeenCalled();
	});

	it('refuses a member of another committee who is not staff', async () => {
		signedIn = true;
		staff = false;
		committeeOf = ['grp-other'];
		await expect(decide()).rejects.toMatchObject({ status: 403 });
		expect(svc.decideApplication).not.toHaveBeenCalled();
	});

	it('refuses an anonymous caller on event.manage', async () => {
		await expect(decide()).rejects.toMatchObject({ status: 401 });
		expect(requested).toEqual(['event.manage']);
	});
});

describe('the committee view of a market', () => {
	it('shows the owning committee its applications without any contact detail', async () => {
		committeeOf = ['grp-dev', 'proj-dev'];
		svc.getMarketDay.mockResolvedValueOnce({ eventId: 'evt-1' } as never);
		svc.listApplications.mockResolvedValueOnce([
			{
				id: 'v-1',
				businessName: 'Rosa Ceramics',
				threadId: 'thr-1',
				contactName: 'Rosa Diaz',
				contactEmail: 'rosa@example.com',
				contactPhone: '541-555-0100'
			}
		] as never);

		const view = (await remote.getCommitteeMarketVendors('evt-1')) as {
			applications: Record<string, unknown>[];
		};

		expect(guardedOn).toEqual([['proj-dev', 'event.manage']]);
		expect(view.applications).toEqual([{ id: 'v-1', businessName: 'Rosa Ceramics' }]);
	});

	it('refuses anyone outside the committee who is not staff', async () => {
		signedIn = true;
		staff = false;
		await expect(remote.getCommitteeMarketVendors('evt-1')).rejects.toMatchObject({
			status: 403
		});
	});

	it("lists a committee's markets only to its members or staff", async () => {
		committeeOf = ['grp-dev', 'proj-dev'];
		await remote.getCommitteeMarkets('grp-dev');
		expect(guardedOn).toEqual([['grp-dev', 'event.manage']]);
		expect(svc.listCommitteeMarkets).toHaveBeenCalledWith('grp-dev');
	});
});

describe('the market fee (#1502)', () => {
	it('is set with the market, in cents', async () => {
		signedIn = true;
		await submit(remote.openMarketDayForm, {
			eventId: 'evt-1',
			tableFeeCents: 2500,
			slidingScale: true,
			slidingScaleFloorCents: 1000
		});
		expect(svc.openMarketDay).toHaveBeenCalledWith(
			'evt-1',
			expect.objectContaining({
				tableFeeCents: 2500,
				slidingScale: true,
				slidingScaleFloorCents: 1000
			})
		);
	});

	it('leaves a free market free', async () => {
		signedIn = true;
		await submit(remote.openMarketDayForm, { eventId: 'evt-1' });
		expect(svc.openMarketDay).toHaveBeenCalledWith(
			'evt-1',
			expect.objectContaining({ tableFeeCents: 0, slidingScale: false })
		);
	});
});

describe('paying the fee, with no account', () => {
	it('shows the fee page for a vendor id, and 404s one that names nothing', async () => {
		await expect(remote.getVendorFeePage('v-404')).rejects.toMatchObject({ status: 404 });
		fees.getVendorFee.mockResolvedValueOnce({ vendorId: 'v-1', due: true });
		await expect(remote.getVendorFeePage('v-1')).resolves.toMatchObject({ vendorId: 'v-1' });
	});

	it('starts a checkout for the chosen amount, back to this site', async () => {
		const result = await submit(remote.payVendorFeeForm, { vendorId: 'v-1', amountCents: 1500 });
		expect(fees.startVendorFeeCheckout).toHaveBeenCalledWith('v-1', 1500, 'https://corvmc.org');
		expect(result).toEqual({ redirectUrl: '/checkout/cs_1' });
	});
});
