import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ZodType } from 'zod';

// Pins who may call what: the staff mutations name `user.setEmail`, and
// the two public ones are guarded by the token alone, since the member
// confirming is usually the one who cannot sign in.

const requireCapability = vi.fn(async (_cap: string) => ({ id: 'staff-1' }));
const can = vi.fn(async (_cap: string) => true);
vi.mock('$lib/server/authorization', () => ({
	requireCapability: (cap: string) => requireCapability(cap),
	can: (cap: string) => can(cap)
}));

class Rejected extends Error {}
const service = {
	requestEmailChange: vi.fn(async () => ({})),
	cancelEmailChange: vi.fn(async () => undefined),
	getPendingEmailChange: vi.fn(async () => null),
	getEmailChangeRequest: vi.fn(async () => null),
	confirmEmailChange: vi.fn(async () => ({ status: 'invalid' }))
};
vi.mock('$lib/server/user/email-change-service', () => ({
	EmailChangeRejectedError: Rejected,
	...Object.fromEntries(
		Object.entries(service).map(([k, fn]) => [k, (...a: unknown[]) => fn(...(a as []))])
	)
}));

class InvalidCalled extends Error {
	constructor(readonly issues: unknown[]) {
		super('invalid');
	}
}
vi.mock('@sveltejs/kit', () => ({
	invalid: (...issues: unknown[]) => {
		throw new InvalidCalled(issues);
	},
	error: (status: number, message: string) => {
		throw Object.assign(new Error(message), { status });
	}
}));

vi.mock('$app/server', () => {
	const mark = <T extends object>(fn: T, type: string) =>
		Object.assign(fn, { __: { type }, for: () => fn });
	return {
		query: (schema: ZodType, handler: (a: unknown) => Promise<unknown>) =>
			mark((raw: unknown) => {
				const p = handler(schema.parse(raw)) as Promise<unknown> & { refresh: () => void };
				p.refresh = () => undefined;
				return p;
			}, 'query'),
		form: (schema: ZodType, handler: (d: unknown, i: unknown) => unknown) =>
			mark(async (raw: unknown, issue: unknown) => handler(schema.parse(raw), issue), 'form'),
		command: vi.fn()
	};
});

type Fn = (data: unknown, issue?: unknown) => Promise<unknown>;
const remote = (await import('./email-change.remote')) as unknown as Record<string, Fn>;

const issue = { email: (message: string) => ({ path: ['email'], message }) };

beforeEach(() => vi.clearAllMocks());

describe('staff functions', () => {
	it('the pending read shows nothing actionable without user.setEmail', async () => {
		can.mockResolvedValueOnce(false);
		expect(await remote.getPendingEmailChange('usr-1')).toEqual({
			canChange: false,
			pending: null
		});
		expect(requireCapability).toHaveBeenCalledWith('user.read');
		expect(can).toHaveBeenCalledWith('user.setEmail');
		expect(service.getPendingEmailChange).not.toHaveBeenCalled();
	});

	it.each([
		['requestEmailChange', { userId: 'usr-1', email: 'a@example.com' }],
		['cancelEmailChange', { userId: 'usr-1' }]
	])('%s requires user.setEmail', async (name, input) => {
		await remote[name](input, issue);
		expect(requireCapability).toHaveBeenCalledWith('user.setEmail');
	});

	it('does nothing when the guard refuses', async () => {
		requireCapability.mockRejectedValueOnce(new Error('403'));
		await expect(
			remote.requestEmailChange({ userId: 'usr-1', email: 'a@example.com' }, issue)
		).rejects.toThrow('403');
		expect(service.requestEmailChange).not.toHaveBeenCalled();
	});

	it('puts a refusal on the email field', async () => {
		service.requestEmailChange.mockRejectedValueOnce(new Rejected('taken'));
		await expect(
			remote.requestEmailChange({ userId: 'usr-1', email: 'a@example.com' }, issue)
		).rejects.toMatchObject({ issues: [{ path: ['email'], message: 'taken' }] });
	});

	it('rejects a malformed address before the service sees it', async () => {
		await expect(
			remote.requestEmailChange({ userId: 'usr-1', email: 'not-an-email' }, issue)
		).rejects.toThrow();
		expect(service.requestEmailChange).not.toHaveBeenCalled();
	});
});

describe('public functions', () => {
	it('confirm and the landing query take no capability', async () => {
		await remote.getEmailChangeRequest('tok');
		await remote.confirmEmailChange({ token: 'tok' });
		expect(requireCapability).not.toHaveBeenCalled();
		expect(service.confirmEmailChange).toHaveBeenCalledWith('tok');
	});
});
