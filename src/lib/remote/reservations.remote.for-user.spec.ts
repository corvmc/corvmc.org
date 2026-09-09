import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import type { SQL } from 'drizzle-orm';
import { mockUser } from '$lib/server/db/test-factory';
import { isStaff } from '$lib/server/authorization';

// ---------------------------------------------------------------------------
// Regression: `getReservations({ forUser })` rejected staff along with
// everyone else.
//
// The guard read `locals.user.isStaff`, which is not a field on the
// better-auth user — `src/lib/server/auth-fields.ts` declares no such
// `additionalField` — so it was always `undefined` and the staff arm of the
// check could never be taken. It typechecked silently because better-auth's
// `User` is loose, and it is the only staff check in reservations.remote.ts
// that does not resolve the role (the other five all `await isStaff(id)`).
//
// The failure is a closed guard, not an open one: nobody could see another
// member's reservations, staff included. These tests pin all three arms.
// ---------------------------------------------------------------------------

const actingUser = mockUser({ id: 'user-1', name: 'Acting', email: 'acting@example.com' });

const rows: unknown[] = [];
/** What the list was ordered by, so a test can tell newest-first from oldest-first. */
const orderByArgs: unknown[] = [];
vi.mock('$lib/server/db', () => ({
	db: {
		select: () => {
			const c: Record<string, unknown> = {
				from: () => c,
				where: () => c,
				orderBy: (arg: unknown) => {
					orderByArgs.push(arg);
					return Promise.resolve(rows);
				}
			};
			return c;
		}
	}
}));

vi.mock('$lib/server/authorization', () => ({
	isStaff: vi.fn(async () => false),
	requireCapability: vi.fn(async () => actingUser),
	requireUser: () => actingUser,
	requireCapabilityOrOwner: vi.fn(),
	primaryRoleFor: vi.fn()
}));

vi.mock('$lib/server/reservation/config', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/reservation/config')>()),
	getReservationConfig: vi.fn(async () => ({ hourlyRateCents: 1500 }))
}));

vi.mock('$lib/server/finance/credit-service', () => ({ getBalance: vi.fn(async () => 0) }));

vi.mock('$lib/server/feature-flags', () => ({ requireFeature: vi.fn(async () => undefined) }));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: actingUser },
		url: new URL('http://localhost/member/reservations'),
		request: { headers: new Headers() }
	}),
	form: (schema: unknown, handler: (...args: any[]) => any) => {
		(handler as any).__ = { type: 'form' };
		(handler as any).__schema = schema;
		(handler as any).for = () => handler;
		return handler;
	},
	query: (...args: any[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (...a: any[]) => any;
		(handler as any).__ = { type: 'query' };
		return handler;
	},
	command: (...args: any[]) => (typeof args[0] === 'function' ? args[0] : args[1])
}));

const { getReservations } = (await import('$lib/remote/reservations.remote')) as any;

beforeEach(() => {
	rows.length = 0;
	orderByArgs.length = 0;
	vi.mocked(isStaff).mockReset();
	vi.mocked(isStaff).mockResolvedValue(false);
});

describe('getReservations({ forUser })', () => {
	it('lets staff list another member’s reservations', async () => {
		// The regression. Before the fix this threw 403, because the staff arm
		// read an undefined property instead of resolving the role.
		vi.mocked(isStaff).mockResolvedValue(true);
		await expect(getReservations({ forUser: 'someone-else' })).resolves.toEqual([]);
		expect(isStaff).toHaveBeenCalledWith(actingUser.id);
	});

	it('refuses a non-staff member asking for someone else', async () => {
		await expect(getReservations({ forUser: 'someone-else' })).rejects.toMatchObject({
			status: 403
		});
	});

	it('lets any member ask for their own, without consulting the role', async () => {
		// Ownership short-circuits: asking for yourself must not cost a DB read.
		await expect(getReservations({ forUser: actingUser.id })).resolves.toEqual([]);
		expect(isStaff).not.toHaveBeenCalled();
	});

	it('needs no forUser to list your own', async () => {
		await expect(getReservations()).resolves.toEqual([]);
		expect(isStaff).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Regression: the All tab drew every reservation a member had ever had, oldest
// first. Two years in that is 53 rows opening on their first-ever booking, with
// no control to reverse it. History reads backward; an upcoming list does not.
// #875.
// ---------------------------------------------------------------------------

describe('getReservations ordering', () => {
	const dialect = new SQLiteSyncDialect();

	it('lists history newest first when asked', async () => {
		await getReservations({ includeTerminal: true, newestFirst: true });

		const rendered = dialect.sqlToQuery(orderByArgs.at(-1) as SQL).sql;
		expect(rendered).toMatch(/desc/i);
	});

	it('leaves an upcoming list reading forward', async () => {
		await getReservations({});

		// A bare column, not a `desc(...)` fragment: the next booking is the one
		// that matters, so this list must not flip with the history one.
		expect(orderByArgs.at(-1)).toHaveProperty('name', 'starts_at');
	});
});
