import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ZodType } from 'zod';

// ---------------------------------------------------------------------------
// What this pins
// ---------------------------------------------------------------------------
// Both functions here are unguarded on purpose, so the properties worth
// protecting are not "who may call this" but "what does the answer tell you".
// A request must look identical for an address that exists, one that doesn't,
// and one that has already asked three times — otherwise the form becomes a
// way to enumerate the membership.
// ---------------------------------------------------------------------------

const requestPasswordResetApi = vi.fn(async () => ({ status: true }));
const resetPasswordApi = vi.fn(async () => ({ status: true }));

vi.mock('$lib/server/auth', () => ({
	auth: {
		api: {
			requestPasswordReset: (...args: unknown[]) => requestPasswordResetApi(...(args as [])),
			resetPassword: (...args: unknown[]) => resetPasswordApi(...(args as []))
		}
	}
}));

const allowRateLimited = vi.fn(async (_key: unknown) => true);
vi.mock('$lib/server/rate-limit', () => ({
	allowRateLimited: (...args: unknown[]) => allowRateLimited(args[0])
}));

/** Thrown by the `invalid` stub so a spec can read the issue back. */
class InvalidCalled extends Error {
	constructor(readonly issues: unknown[]) {
		super('invalid');
	}
}

vi.mock('@sveltejs/kit', () => ({
	invalid: (...issues: unknown[]) => {
		throw new InvalidCalled(issues);
	}
}));

let requestHeaders = new Headers();

// Unlike the other remote specs, this `form` mock runs the Zod schema before
// the handler. The cross-field password check is part of what is being tested,
// and a schema that is never executed cannot be wrong.
vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: null },
		url: new URL('http://localhost/'),
		request: { headers: requestHeaders }
	}),
	form: (schema: ZodType, handler: (data: unknown, issue: unknown) => unknown) => {
		const fn = async (raw: unknown, issue: unknown) => handler(schema.parse(raw), issue);
		// Kit refuses to import a `.remote.ts` whose exports are not marked, so the
		// stand-in has to carry the same marker the real `form()` attaches.
		Object.assign(fn, { __: { type: 'form' }, for: () => fn });
		return fn;
	}
}));

const { requestPasswordReset, resetPassword } =
	(await import('./password-reset.remote')) as unknown as {
		requestPasswordReset: (data: unknown, issue?: unknown) => Promise<{ sent: boolean }>;
		resetPassword: (data: unknown, issue?: unknown) => Promise<{ reset: boolean }>;
	};

/** The `issue` helper SvelteKit hands a form handler, narrowed to what we use. */
const issue = { token: (message: string) => ({ path: ['token'], message }) };

beforeEach(() => {
	vi.clearAllMocks();
	allowRateLimited.mockResolvedValue(true);
	requestPasswordResetApi.mockResolvedValue({ status: true });
	resetPasswordApi.mockResolvedValue({ status: true });
	requestHeaders = new Headers();
});

describe('requestPasswordReset', () => {
	it('sends the address on to better-auth, lowercased, with a relative redirect', async () => {
		await requestPasswordReset({ email: '  Maya@Example.COM  ' });

		expect(requestPasswordResetApi).toHaveBeenCalledWith({
			body: { email: 'maya@example.com', redirectTo: '/reset-password' }
		});
	});

	it('throttles by address and by source IP separately', async () => {
		requestHeaders = new Headers({ 'CF-Connecting-IP': '203.0.113.7' });
		await requestPasswordReset({ email: 'maya@example.com' });

		const keys = allowRateLimited.mock.calls.map((c) => (c as unknown as string[])[0]);
		expect(keys).toEqual(
			expect.arrayContaining(['pw-reset:email:maya@example.com', 'pw-reset:ip:203.0.113.7'])
		);
	});

	it('buckets a request with no resolvable IP rather than sharing the address bucket', async () => {
		await requestPasswordReset({ email: 'maya@example.com' });

		const keys = allowRateLimited.mock.calls.map((c) => (c as unknown as string[])[0]);
		expect(keys).toContain('pw-reset:ip:unknown');
	});

	it('sends nothing once the address is over its budget, and says so to nobody', async () => {
		allowRateLimited.mockImplementation(
			async (key: unknown) => !String(key).startsWith('pw-reset:email:')
		);

		const result = await requestPasswordReset({ email: 'maya@example.com' });

		expect(requestPasswordResetApi).not.toHaveBeenCalled();
		expect(result).toEqual({ sent: true });
	});

	it('sends nothing once the source IP is over its budget', async () => {
		allowRateLimited.mockImplementation(
			async (key: unknown) => !String(key).startsWith('pw-reset:ip:')
		);

		const result = await requestPasswordReset({ email: 'maya@example.com' });

		expect(requestPasswordResetApi).not.toHaveBeenCalled();
		expect(result).toEqual({ sent: true });
	});

	it('answers a throttled request exactly as it answers an accepted one', async () => {
		const accepted = await requestPasswordReset({ email: 'maya@example.com' });
		allowRateLimited.mockResolvedValue(false);
		const throttled = await requestPasswordReset({ email: 'maya@example.com' });

		expect(throttled).toEqual(accepted);
	});

	it('rejects an address that is not one', async () => {
		await expect(requestPasswordReset({ email: 'not-an-email' })).rejects.toThrow();
	});
});

describe('resetPassword', () => {
	const good = {
		token: 'PfQ2rN8xKvT1',
		newPassword: 'a new long password',
		confirmPassword: 'a new long password'
	};

	it('hands the token and the new password to better-auth', async () => {
		const result = await resetPassword(good, issue);

		expect(resetPasswordApi).toHaveBeenCalledWith({
			body: { token: good.token, newPassword: good.newPassword }
		});
		expect(result).toEqual({ reset: true });
	});

	it('refuses a confirmation that does not match, on the confirmation field', async () => {
		await expect(
			resetPassword({ ...good, confirmPassword: 'something else' }, issue)
		).rejects.toMatchObject({
			issues: [expect.objectContaining({ path: ['confirmPassword'] })]
		});
		expect(resetPasswordApi).not.toHaveBeenCalled();
	});

	it('refuses a password shorter than the minimum', async () => {
		await expect(
			resetPassword({ token: good.token, newPassword: 'short', confirmPassword: 'short' }, issue)
		).rejects.toThrow();
		expect(resetPasswordApi).not.toHaveBeenCalled();
	});

	it('turns a spent or expired token into a field issue rather than a 500', async () => {
		resetPasswordApi.mockRejectedValue(
			Object.assign(new Error('Invalid token'), {
				status: 'BAD_REQUEST',
				body: { message: 'Invalid token', code: 'INVALID_TOKEN' }
			})
		);

		await expect(resetPassword(good, issue)).rejects.toBeInstanceOf(InvalidCalled);
	});

	it('lets anything else through, so a real fault is still a fault', async () => {
		resetPasswordApi.mockRejectedValue(new Error('D1 is on fire'));

		await expect(resetPassword(good, issue)).rejects.toThrow('D1 is on fire');
	});
});
