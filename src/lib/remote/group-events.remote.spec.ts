import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { z } from 'zod';

/**
 * #714. All five session writes reach the one member-facing path that holds the
 * practice room for free, and the guard they used was kind-agnostic — a band
 * admin naming their own band's id got a `confirmed` reservation nobody pays
 * for. What is pinned here is the guard each remote goes through, not the
 * service behind it.
 */

class ValidationFailure extends Error {
	constructor(readonly issues: z.core.$ZodIssue[]) {
		super('validation failed');
	}
}

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: { user: { id: 'user-1' } }, url: new URL('http://x/') }),
	form: (schema: z.ZodType, handler: (...a: unknown[]) => unknown) => {
		const fn = async (raw: unknown) => {
			const parsed = schema.safeParse(raw);
			if (!parsed.success) throw new ValidationFailure(parsed.error.issues);
			return handler(parsed.data, {});
		};
		const marked = fn as unknown as Record<string, unknown>;
		marked.__ = { type: 'form' };
		marked.for = () => fn;
		return fn;
	}
}));

/** Faithful to the real guards: 404 an unknown ref, 404 a band under the program guard. */
const GROUPS: Record<string, { id: string; slug: string; kind: string }> = {
	'group-1': { id: 'group-1', slug: 'real-book-club', kind: 'club' },
	'band-1': { id: 'band-1', slug: 'wren-halloway', kind: 'band' }
};

const httpError = (status: number, message: string) =>
	Object.assign(new Error(message), { status, body: { message } });

const requireGroupRole = vi.fn(async (ref: { id?: string }) => {
	const group = GROUPS[ref.id ?? ''];
	if (!group) throw httpError(404, 'Group not found');
	return { user: { id: 'user-1' }, group, role: 'admin' as const };
});
const requireProgramRole = vi.fn(async (ref: { id?: string }) => {
	const ctx = await requireGroupRole(ref);
	if (ctx.group.kind === 'band') throw httpError(404, 'Group not found');
	return ctx;
});
vi.mock('$lib/server/group/group-context', () => ({
	requireGroupRole: (...a: unknown[]) =>
		requireGroupRole(...(a as Parameters<typeof requireGroupRole>)),
	requireProgramRole: (...a: unknown[]) =>
		requireProgramRole(...(a as Parameters<typeof requireProgramRole>))
}));

const service = {
	createGroupEvent: vi.fn(async () => ({ id: 'evt-1' })),
	getById: vi.fn(async () => ({ id: 'evt-1', groupId: 'group-1' })),
	publish: vi.fn(async () => undefined),
	unpublish: vi.fn(async () => undefined),
	cancelGroupSession: vi.fn(async () => undefined),
	updateGroupSession: vi.fn(async () => undefined)
};
vi.mock('$lib/server/event/event-service', () => ({
	createGroupEvent: (...a: unknown[]) => service.createGroupEvent(...(a as [])),
	getById: (...a: unknown[]) => service.getById(...(a as [])),
	publish: (...a: unknown[]) => service.publish(...(a as [])),
	unpublish: (...a: unknown[]) => service.unpublish(...(a as [])),
	cancelGroupSession: (...a: unknown[]) => service.cancelGroupSession(...(a as [])),
	updateGroupSession: (...a: unknown[]) => service.updateGroupSession(...(a as []))
}));

vi.mock('$lib/server/errors', () => ({
	mapDomainError: (err: unknown) => {
		throw err;
	}
}));

// Cast, as the sibling remote specs do: the mocked `form()` returns a plain
// function, but the module's declared type is `RemoteForm`, which is not callable.
const remotes = (await import('./group-events.remote')) as unknown as Record<
	string,
	(...args: unknown[]) => Promise<unknown>
>;

const statusOf = async (fn: () => Promise<unknown>) => {
	try {
		await fn();
	} catch (e) {
		return (e as { status?: number }).status ?? 0;
	}
	throw new Error('expected a throw');
};

const SESSION = {
	title: 'Monthly jam',
	sessionDate: '2026-09-17',
	startTime: '19:00',
	endTime: '21:00'
};

beforeEach(() => {
	vi.clearAllMocks();
	service.createGroupEvent.mockResolvedValue({ id: 'evt-1' });
	service.getById.mockResolvedValue({ id: 'evt-1', groupId: 'group-1' });
});

describe('a band cannot reach the group-session writes', () => {
	it('404s a band id on create, before the room is touched', async () => {
		expect(
			await statusOf(() =>
				remotes.createGroupSession({ groupId: 'band-1', ...SESSION, reserveRoom: true })
			)
		).toBe(404);

		expect(service.createGroupEvent).not.toHaveBeenCalled();
	});

	it.each([
		['updateGroupSession', { ...SESSION }],
		['cancelGroupSession', {}],
		['publishGroupSession', {}],
		['unpublishGroupSession', {}]
	])('404s a band id on %s', async (name, extra) => {
		expect(
			await statusOf(() => remotes[name]({ groupId: 'band-1', eventId: 'evt-1', ...extra }))
		).toBe(404);

		// The guard runs before the event is even looked up, so nothing leaks which
		// session ids exist.
		expect(service.getById).not.toHaveBeenCalled();
	});
});

describe('a program still reaches them', () => {
	it('creates a session for a club', async () => {
		await remotes.createGroupSession({ groupId: 'group-1', ...SESSION, reserveRoom: true });

		expect(service.createGroupEvent).toHaveBeenCalledOnce();
		expect(service.createGroupEvent).toHaveBeenCalledWith(
			expect.objectContaining({ groupId: 'group-1' })
		);
	});

	it.each(['cancelGroupSession', 'publishGroupSession', 'unpublishGroupSession'])(
		'%s reaches the service for a club',
		async (name) => {
			await expect(remotes[name]({ groupId: 'group-1', eventId: 'evt-1' })).resolves.toMatchObject({
				success: true
			});
		}
	);
});
