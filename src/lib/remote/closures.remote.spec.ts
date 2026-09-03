import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isValidationError } from '@sveltejs/kit';

// Regression: `createClosure` called `issue.endsAt(...)` without throwing it.
// Constructing an issue is inert — only `invalid()` throws — so an inverted date
// range fell through to the INSERT and wrote a closure ending before it starts.
// `updateClosure` rejects the identical condition, which is what the create path
// was meant to do too.

const insertValues = vi.fn(async () => undefined);
const db = { insert: vi.fn(() => ({ values: insertValues })), select: vi.fn() };

vi.mock('$lib/server/db', () => ({ db }));
vi.mock('$lib/server/authorization', () => ({
	requireCapability: vi.fn(async () => ({ id: 's-1' }))
}));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: { user: null }, request: { headers: new Headers() } }),
	// Queries are stubbed wholesale rather than passed through: the handlers under
	// test end with `getClosures().refresh()`, so the stub only has to be callable
	// and hand back a refreshable handle.
	query: () => {
		const stub = (() => ({ refresh: async () => undefined })) as unknown as Record<string, unknown>;
		stub.__ = { type: 'query' };
		return stub;
	},
	command: (...args: unknown[]) => tag(args, 'command'),
	form: (...args: unknown[]) => tag(args, 'form')
}));

function tag(args: unknown[], type: string) {
	const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as Record<string, unknown>;
	handler.__ = { type };
	handler.for = () => handler;
	return handler;
}

const closures = (await import('./closures.remote')) as unknown as Record<
	string,
	(data: unknown, issue: unknown) => Promise<unknown>
>;

function makeIssue() {
	return new Proxy(
		{},
		{ get: (_t, field: string) => (message: string) => ({ message, path: [field] }) }
	);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('createClosure validation', () => {
	it('rejects an end time before the start time without inserting', async () => {
		let thrown: unknown;
		try {
			await closures.createClosure(
				{
					reason: 'Deep clean',
					startsAt: '2026-09-10T18:00:00Z',
					endsAt: '2026-09-10T09:00:00Z'
				},
				makeIssue()
			);
		} catch (e) {
			thrown = e;
		}

		expect(isValidationError(thrown)).toBe(true);
		const issues = (thrown as { issues: Array<{ path: string[] }> }).issues;
		expect(issues.some((i) => i.path?.includes('endsAt'))).toBe(true);
		expect(db.insert).not.toHaveBeenCalled();
	});

	it('rejects a zero-length closure without inserting', async () => {
		let thrown: unknown;
		try {
			await closures.createClosure(
				{
					reason: 'Deep clean',
					startsAt: '2026-09-10T18:00:00Z',
					endsAt: '2026-09-10T18:00:00Z'
				},
				makeIssue()
			);
		} catch (e) {
			thrown = e;
		}

		expect(isValidationError(thrown)).toBe(true);
		expect(db.insert).not.toHaveBeenCalled();
	});

	it('inserts a closure whose end follows its start', async () => {
		await closures.createClosure(
			{
				reason: 'Deep clean',
				startsAt: '2026-09-10T09:00:00Z',
				endsAt: '2026-09-10T18:00:00Z'
			},
			makeIssue()
		);

		expect(db.insert).toHaveBeenCalledTimes(1);
		expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ reason: 'Deep clean' }));
	});
});
