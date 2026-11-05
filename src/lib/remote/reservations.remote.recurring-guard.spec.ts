import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import { mockUser } from '#lib/server/db/test-factory.js';

// `getRecurringReservations` lists the caller's own series. A signed-out call is
// refused before any read, rather than binding an absent id into the filter (#2255).

let signedIn = true;
const where: unknown[] = [];
const select = vi.fn(() => {
	const c: Record<string, unknown> = {
		from: () => c,
		innerJoin: () => c,
		where: (w: unknown) => {
			where.push(w);
			return Promise.resolve([]);
		}
	};
	return c;
});
vi.mock('#lib/server/db/index.js', () => ({ db: { select: () => select() } }));

vi.mock('#lib/server/authorization.js', () => ({
	can: vi.fn(async () => false),
	requireCapability: vi.fn(),
	requireCapabilityOrOwner: vi.fn(),
	requireUser: vi.fn(() => {
		if (!signedIn) throw Object.assign(new Error('401'), { status: 401 });
		return mockUser({ id: 'member-1' });
	})
}));

vi.mock('#lib/server/feature-flags.js', () => ({ requireFeature: vi.fn(async () => undefined) }));

// Kit refuses a remote module whose exports lack the `__` marker.
const mark = (handler: any, type: string) => Object.assign(handler, { __: { type } });
vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: signedIn ? mockUser({ id: 'member-1' }) : null },
		url: new URL('http://localhost/member/reservations'),
		request: { headers: new Headers() }
	}),
	command: (_schema: unknown, handler: (...args: any[]) => any) => mark(handler, 'command'),
	form: (_schema: unknown, handler: (...args: any[]) => any) =>
		Object.assign(mark(handler, 'form'), { for: () => handler, fields: {} }),
	query: (...args: unknown[]) => mark(typeof args[0] === 'function' ? args[0] : args[1], 'query')
}));

const { getRecurringReservations } = (await import('#lib/remote/reservations.remote.js')) as any;

beforeEach(() => {
	vi.clearAllMocks();
	where.length = 0;
	signedIn = true;
});

describe('getRecurringReservations', () => {
	it('refuses a signed-out caller before reading', async () => {
		signedIn = false;
		await expect(getRecurringReservations(undefined)).rejects.toMatchObject({ status: 401 });
		expect(select).not.toHaveBeenCalled();
	});

	it("filters on the caller's id", async () => {
		await getRecurringReservations(undefined);
		const { params } = new SQLiteSyncDialect().sqlToQuery(where[0] as SQL);
		expect(params).toContain('member-1');
	});
});
