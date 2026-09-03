import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Staff guards for the cross-domain half of the staff user record.
 *
 * `/staff/users/[id]` reads a member's whole participation history, and most of
 * it lives outside users.remote.ts — their bands, shifts, loans, tickets,
 * inbox threads, marketing suppression, directory profile. Each of those is a
 * new directly addressable endpoint returning another member's private data.
 *
 * users.remote.spec.ts already pins the guards on that file. This is the same
 * table for the queries that had to live next to their own domain, kept
 * separate rather than merged into any existing domain spec: those specs each
 * mock their domain for a different purpose, and a unioned set of mocks would
 * quietly change what they were testing.
 *
 * The rule being pinned is the one that #162 established: a remote function is
 * only as guarded as its own first line, and its target is the validated
 * argument — never `params.id`, which for a remote call is derived from the
 * caller-supplied `x-sveltekit-pathname` header.
 */

const requireStaff = vi.fn<() => Promise<unknown>>(async () => {
	throw new Error('403: Staff access required');
});

vi.mock('$lib/server/authorization', () => ({
	requireStaff: (...a: unknown[]) => requireStaff(...(a as [])),
	requireUser: () => ({ id: 'acting-staff' }),
	isStaff: vi.fn(async () => false),
	getUserRoles: vi.fn(async () => ['member']),
	listStaffUsers: vi.fn(async () => []),
	topPositionFor: vi.fn(() => null)
}));

// Any database access on a rejected call is a failure.
const dbSelect = vi.fn(() => {
	const b = {
		from: () => b,
		innerJoin: () => b,
		leftJoin: () => b,
		where: () => b,
		orderBy: () => b,
		limit: () => b,
		groupBy: () => b,
		$dynamic: () => b,
		then: (resolve: (v: unknown) => unknown) => resolve([])
	};
	return b;
});
const writeBuilder = () => {
	const b = {
		set: () => b,
		values: () => b,
		where: () => b,
		returning: () => b,
		then: (resolve: (v: unknown) => unknown) => resolve([])
	};
	return b;
};
const dbUpdate = vi.fn(writeBuilder);
const dbDelete = vi.fn(writeBuilder);
const dbInsert = vi.fn(writeBuilder);
const dbBatch = vi.fn(async () => []);
vi.mock('$lib/server/db', () => ({
	db: {
		select: (...a: unknown[]) => dbSelect(...(a as [])),
		update: (...a: unknown[]) => dbUpdate(...(a as [])),
		delete: (...a: unknown[]) => dbDelete(...(a as [])),
		insert: (...a: unknown[]) => dbInsert(...(a as [])),
		batch: (...a: unknown[]) => dbBatch(...(a as []))
	}
}));

// `params.id` is caller-controlled, so a test caller sets it exactly as an
// attacker would: pointed at a different user than the argument.
let currentParams: Record<string, string> = { id: 'someone-else' };
vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: null },
		params: currentParams,
		url: new URL('http://localhost/'),
		request: { headers: new Headers() }
	}),
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => Promise<unknown>;
		const wrapped = (...a: unknown[]) => {
			const p = handler(...a) as Promise<unknown> & { refresh?: () => void };
			p.refresh = () => undefined;
			return p;
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
	},
	prerender: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => unknown;
		(handler as unknown as Record<string, unknown>).__ = { type: 'prerender' };
		return handler;
	}
}));

type RemoteModule = Record<string, (...args: unknown[]) => Promise<unknown>>;

const [
	reservations,
	bands,
	events,
	community,
	volunteer,
	equipment,
	flags,
	inbox,
	notifications,
	marketing,
	directory
] = (await Promise.all([
	import('./reservations.remote'),
	import('./bands.remote'),
	import('./events.remote'),
	import('./community-events.remote'),
	import('./volunteer.remote'),
	import('./inventory.remote'),
	import('./flags.remote'),
	import('./inbox.remote'),
	import('./notifications.remote'),
	import('./marketing.remote'),
	import('./directory.remote')
])) as unknown as RemoteModule[];

beforeEach(() => {
	vi.clearAllMocks();
	requireStaff.mockRejectedValue(new Error('403: Staff access required'));
	currentParams = { id: 'someone-else' };
});

const STAFF_ONLY: Array<{ label: string; call: () => Promise<unknown> }> = [
	{ label: 'getUserRecurringSeries', call: () => reservations.getUserRecurringSeries('victim') },
	{ label: 'getUserBands', call: () => bands.getUserBands('victim') },
	{ label: 'getUserShows', call: () => events.getUserShows('victim') },
	{ label: 'getUserTicketsAndRsvps', call: () => events.getUserTicketsAndRsvps('victim') },
	{ label: 'getUserListings', call: () => community.getUserListings('victim') },
	{ label: 'getUserVolunteerProfile', call: () => volunteer.getUserVolunteerProfile('victim') },
	{ label: 'getUserShifts', call: () => volunteer.getUserShifts('victim') },
	{ label: 'getUserHourLogs', call: () => volunteer.getUserHourLogs('victim') },
	{ label: 'getUserLoans', call: () => equipment.getUserLoans('victim') },
	{ label: 'getFlagsAgainstUser', call: () => flags.getFlagsAgainstUser('victim') },
	{ label: 'getFlagsByUser', call: () => flags.getFlagsByUser('victim') },
	{
		label: 'getUserThreads',
		call: () => inbox.getUserThreads({ userId: 'victim', email: 'victim@example.com' })
	},
	{ label: 'getUserNotifications', call: () => notifications.getUserNotifications('victim') },
	{ label: 'getUserMarketing', call: () => marketing.getUserMarketing('victim') },
	{ label: 'getUserDirectoryProfile', call: () => directory.getUserDirectoryProfile('victim') }
];

describe('staff user record — cross-domain guards', () => {
	for (const { label, call } of STAFF_ONLY) {
		it(`${label} rejects a non-staff caller before touching the database`, async () => {
			await expect(call()).rejects.toThrow('Staff access required');
			expect(dbSelect).not.toHaveBeenCalled();
			expect(dbUpdate).not.toHaveBeenCalled();
			expect(dbDelete).not.toHaveBeenCalled();
			expect(dbInsert).not.toHaveBeenCalled();
			expect(dbBatch).not.toHaveBeenCalled();
		});
	}

	it('covers every new cross-domain query on the staff user record', () => {
		// A new panel query that never lands in the table above would ship
		// unguarded and untested, which is exactly how the original hole opened.
		const covered = new Set(STAFF_ONLY.map((c) => c.label));
		const declared = [
			reservations,
			bands,
			events,
			community,
			volunteer,
			equipment,
			flags,
			inbox,
			notifications,
			marketing,
			directory
		].flatMap((mod) =>
			Object.keys(mod).filter((name) => /^getUser|^getFlags(Against|By)User$/.test(name))
		);

		expect([...new Set(declared)].filter((name) => !covered.has(name))).toEqual([]);
	});
});
