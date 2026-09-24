import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

/**
 * The market remotes' two boundaries: the public form checks Turnstile before
 * anything is filed, and every staff export names `event.manage`.
 */

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ request: new Request('http://x/'), locals: {} }),
	query: (schema: z.ZodType, handler: (a: unknown) => unknown) =>
		Object.assign(async (raw: unknown) => handler(schema.parse(raw)), { __: { type: 'query' } }),
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
	withdrawApplication: vi.fn(async () => ({ eventId: 'evt-1' }))
}));
vi.mock('$lib/server/market/market-service', () => svc);

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
	requested.length = 0;
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
		[
			'decideVendorForm',
			() =>
				submit(remote.decideVendorForm, { vendorId: 'v-1', decision: 'accepted', message: 'In' })
		],
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
