import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidationError } from '@sveltejs/kit';

// Regression: `getUnsubscribeInfo` is a `query` — it answers a GET — but it
// called `unsubscribe()` as a side effect while merely rendering the page.
// Anything that fetches a URL without a human deciding to (link-prefetching and
// link-scanning mail clients, corporate URL-rewrite security scanners, chat
// unfurlers) therefore unsubscribed the recipient the moment the email was
// opened or forwarded. The unsubscribe must only happen on an explicit POST.
//
// These tests pin the split: the query is read-only, and a separate
// `confirmUnsubscribe` form performs the write.

const unsubscribe = vi.fn(async () => undefined);
const getAudience = vi.fn(async (id: string) => ({ id, name: 'Newsletter' }));

vi.mock('$lib/server/marketing/audience-service', () => ({
	listAudiences: vi.fn(),
	getAudience: (...args: unknown[]) => getAudience(...(args as [string])),
	getAudienceBySlug: vi.fn(),
	getOptInAudiences: vi.fn(),
	createAudience: vi.fn(),
	updateAudience: vi.fn(),
	deleteAudience: vi.fn(),
	addSubscriber: vi.fn(),
	removeSubscriber: vi.fn(),
	unsubscribe: (...args: unknown[]) => unsubscribe(...(args as [])),
	bulkAddMembers: vi.fn(),
	listSubscribers: vi.fn()
}));

const verifyUnsubscribeToken = vi.fn((token: string) =>
	token === 'good-token' ? { subscriberId: 'sub-1', audienceId: 'aud-1' } : null
);
vi.mock('$lib/server/marketing/unsubscribe', () => ({
	verifyUnsubscribeToken: (...args: unknown[]) => verifyUnsubscribeToken(...(args as [string])),
	signUnsubscribeToken: vi.fn()
}));

vi.mock('$lib/server/marketing/campaign-service', () => ({
	listCampaigns: vi.fn(),
	getCampaign: vi.fn(),
	createCampaign: vi.fn(),
	updateCampaign: vi.fn(),
	deleteCampaign: vi.fn(),
	sendNow: vi.fn(),
	scheduleCampaign: vi.fn(),
	unscheduleCampaign: vi.fn(),
	renderCampaignPreview: vi.fn()
}));

const findOrCreateByEmail = vi.fn(async () => ({ id: 'sub-1' }));
vi.mock('$lib/server/marketing/subscriber-service', () => ({
	findOrCreateByEmail: (...a: unknown[]) => findOrCreateByEmail(...(a as []))
}));

const verifyTurnstile = vi.fn(async () => true);
vi.mock('$lib/server/turnstile', () => ({
	verifyTurnstile: (...a: unknown[]) => verifyTurnstile(...(a as []))
}));
vi.mock('$lib/server/authorization', () => ({ requireCapability: vi.fn(async () => undefined) }));
vi.mock('$lib/server/feature-flags', () => ({ requireFeature: vi.fn(async () => undefined) }));
vi.mock('$lib/server/utils/slug', () => ({ generateSlug: vi.fn(), ensureUniqueSlug: vi.fn() }));
vi.mock('$lib/server/db', () => ({ db: {} }));

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
		(handler as unknown as Record<string, unknown>).__ = { type: 'query' };
		return handler;
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

const marketing = (await import('./marketing.remote')) as unknown as Record<
	string,
	(...args: unknown[]) => Promise<unknown>
>;

beforeEach(() => {
	vi.clearAllMocks();
});

describe('getUnsubscribeInfo', () => {
	it('does not unsubscribe anyone — it only reads', async () => {
		const result = (await marketing.getUnsubscribeInfo('good-token')) as {
			valid: boolean;
			audienceName: string | null;
		};

		// The bug: this assertion failed because the query wrote through to
		// `unsubscribe()`, so a prefetch of the link was a completed unsubscribe.
		expect(unsubscribe).not.toHaveBeenCalled();
		expect(result).toEqual({ valid: true, audienceName: 'Newsletter' });
	});

	it('reports an invalid token without writing', async () => {
		const result = (await marketing.getUnsubscribeInfo('tampered')) as { valid: boolean };

		expect(result.valid).toBe(false);
		expect(unsubscribe).not.toHaveBeenCalled();
	});
});

describe('confirmUnsubscribe', () => {
	it('performs the unsubscribe for a valid token', async () => {
		const result = (await marketing.confirmUnsubscribe({ token: 'good-token' })) as {
			valid: boolean;
			audienceName: string | null;
		};

		expect(unsubscribe).toHaveBeenCalledWith('sub-1', 'aud-1');
		expect(result).toEqual({ valid: true, audienceName: 'Newsletter' });
	});

	it('refuses a tampered token', async () => {
		const result = (await marketing.confirmUnsubscribe({ token: 'tampered' })) as {
			valid: boolean;
		};

		expect(result.valid).toBe(false);
		expect(unsubscribe).not.toHaveBeenCalled();
	});
});

// Regression: the failed-Turnstile branch called `issue.turnstileToken(...)` and
// then bare `return`. Constructing an issue does nothing on its own — only
// `invalid()` throws it — so the handler resolved as if it had succeeded. The
// visitor got a form that silently did nothing, with no error to act on.
describe('subscribeToAudience Turnstile failure', () => {
	function makeIssue() {
		return new Proxy(
			{},
			{ get: (_t, field: string) => (message: string) => ({ message, path: [field] }) }
		);
	}

	it('rejects a failed Turnstile check instead of resolving silently', async () => {
		verifyTurnstile.mockResolvedValueOnce(false);

		let thrown: unknown;
		try {
			await marketing.subscribeToAudience(
				{
					slug: 'newsletter',
					email: 'ada@example.com',
					name: 'Ada',
					turnstileToken: 'bot-token'
				},
				makeIssue()
			);
		} catch (e) {
			thrown = e;
		}

		expect(isValidationError(thrown)).toBe(true);
		const issues = (thrown as { issues: Array<{ path: string[] }> }).issues;
		expect(issues.some((i) => i.path?.includes('turnstileToken'))).toBe(true);
		expect(findOrCreateByEmail).not.toHaveBeenCalled();
	});
});
