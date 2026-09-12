import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A band's premium card belonged to whoever set it up, with nothing showing it
 * and no way to replace it (#1098). These pin the two things that make the
 * band-scoped path safe: it is guarded as the band, and it never writes the
 * card onto a person.
 */

let role: 'owner' | 'admin' | 'member' = 'admin';
const mockRequireGroupRole = vi.fn(async (ref: { slug: string }, min: string) => {
	if (role === 'member' && min !== 'member') throw Object.assign(new Error('403'), { status: 403 });
	return { group: { id: 'band-1', slug: ref.slug }, role };
});
vi.mock('$lib/server/group/group-context', () => ({
	requireGroupRole: (...a: unknown[]) => mockRequireGroupRole(...(a as [{ slug: string }, string]))
}));

let customerRow: unknown[] = [{ stripeCustomerId: 'cus_band' }];
vi.mock('$lib/server/db', () => ({
	db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => customerRow }) }) }) }
}));
vi.mock('$lib/server/db/schema/band-site', () => ({
	bandSite: { groupId: 'groupId', stripeCustomerId: 'stripeCustomerId' }
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn() }));

const mockListCards = vi.fn(async () => [{ id: 'pm_1', brand: 'visa', last4: '4242' }]);
const mockRememberCard = vi.fn(async () => undefined);
const mockRemoveCard = vi.fn(async () => undefined);
vi.mock('$lib/server/finance/billing-service', () => ({
	createSetupIntent: vi.fn(async () => 'seti_1_secret_x'),
	listCards: (...a: unknown[]) => mockListCards(...(a as [])),
	listInvoices: vi.fn(async () => []),
	removeCard: (...a: unknown[]) => mockRemoveCard(...(a as [])),
	rememberCard: (...a: unknown[]) => mockRememberCard(...(a as [])),
	setDefaultCard: vi.fn()
}));

const mockRetrieve = vi.fn();
vi.mock('$lib/server/stripe', () => ({
	paymentDriver: () => 'stripe',
	stripe: { setupIntents: { retrieve: (...a: unknown[]) => mockRetrieve(...(a as [])) } }
}));
vi.mock('$lib/server/authorization', () => ({ requireMember: vi.fn() }));
vi.mock('$lib/server/finance/gateway/fake-gateway', () => ({ completeFakeSetupIntent: vi.fn() }));
vi.mock('$lib/server/errors', () => ({
	mapDomainError: (e: unknown) => {
		throw e;
	}
}));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

// SvelteKit validates every export of a .remote.ts at import time, so the stubs
// carry the same marker the real helpers attach. Same shape as
// `audio.remote.spec.ts`.
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

const { getBandBilling, finishBandAddCard, forgetBandCard } = await import('./billing.remote');

beforeEach(() => {
	vi.clearAllMocks();
	role = 'admin';
	customerRow = [{ stripeCustomerId: 'cus_band' }];
});

describe('band billing', () => {
	it('reads the cards on the band’s own customer', async () => {
		const result = await getBandBilling('ninety-proof');

		expect(mockListCards).toHaveBeenCalledWith('cus_band');
		expect(result.cards).toHaveLength(1);
	});

	it('lets an admin manage it, not just the owner', async () => {
		await getBandBilling('ninety-proof');

		expect(mockRequireGroupRole).toHaveBeenCalledWith({ slug: 'ninety-proof' }, 'admin');
	});

	it('refuses a plain member', async () => {
		role = 'member';

		await expect(getBandBilling('ninety-proof')).rejects.toMatchObject({ status: 403 });
	});

	it('400s an act with no billing account rather than guessing one', async () => {
		customerRow = [{ stripeCustomerId: null }];

		await expect(getBandBilling('ninety-proof')).rejects.toMatchObject({ status: 400 });
	});

	it('saves a confirmed card against the band and no user', async () => {
		mockRetrieve.mockResolvedValue({
			customer: 'cus_band',
			status: 'succeeded',
			payment_method: 'pm_new'
		});

		await finishBandAddCard({ slug: 'ninety-proof', setupIntentId: 'seti_1' });

		// `null` is the point: the card is the band's, so nothing mirrors it onto
		// the person who happened to add it.
		expect(mockRememberCard).toHaveBeenCalledWith(null, 'cus_band', 'pm_new');
	});

	it('refuses a setup intent raised against another customer', async () => {
		mockRetrieve.mockResolvedValue({
			customer: 'cus_someone_else',
			status: 'succeeded',
			payment_method: 'pm_new'
		});

		await expect(
			finishBandAddCard({ slug: 'ninety-proof', setupIntentId: 'seti_1' })
		).rejects.toMatchObject({ status: 403 });
		expect(mockRememberCard).not.toHaveBeenCalled();
	});

	it('refuses an unconfirmed intent', async () => {
		mockRetrieve.mockResolvedValue({ customer: 'cus_band', status: 'requires_action' });

		await expect(
			finishBandAddCard({ slug: 'ninety-proof', setupIntentId: 'seti_1' })
		).rejects.toMatchObject({ status: 400 });
	});

	it('forgets a card against the band and no user', async () => {
		await forgetBandCard({ slug: 'ninety-proof', paymentMethodId: 'pm_1' });

		expect(mockRemoveCard).toHaveBeenCalledWith(null, 'cus_band', 'pm_1');
	});
});
