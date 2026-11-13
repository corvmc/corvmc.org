import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';

/**
 * The door list on a volunteer's shift page (#2794), through the remotes, against a real
 * SQLite and the real role-grant resolver: `event.checkIn` on the shift's role, a confirmed
 * signup, and now inside the shift. The same resolver gates `finance.collect` at the door.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb, getRowCount: () => 0 }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('#lib/server/finance/subscription-service.js', () => ({
	isSustainingMember: async () => false,
	isSustainingMemberSql: () => sql`0`
}));

vi.mock('$app/server', () => {
	const mark = <F>(fn: F, type: string) => Object.assign(fn as object, { __: { type } }) as F;
	const call = (run: () => Promise<unknown>) => ({
		then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => run().then(ok, fail),
		refresh: async () => {}
	});
	return {
		getRequestEvent: () => ({ locals: { user: { id: 'nia' } }, url: new URL('http://x/') }),
		query: (...args: unknown[]) => {
			const handler = args.at(-1) as (raw: unknown) => Promise<unknown>;
			return mark((raw: unknown) => call(() => handler(raw)), 'query');
		},
		form: (...args: unknown[]) => mark(args.at(-1), 'form'),
		command: (...args: unknown[]) => mark(args.at(-1), 'command')
	};
});

// No position: every grant comes from the volunteer role, through the real resolver.
vi.mock('#lib/server/authorization.js', async () => {
	const { error } = await import('@sveltejs/kit');
	const { roleGrantAllows } = await import('#lib/server/capability/capability-grants.js');
	const can = async (cap: string, scope?: { eventId?: string }) =>
		scope?.eventId ? roleGrantAllows('nia', cap as never, scope.eventId) : false;
	return {
		requireUser: () => ({ id: 'nia' }),
		can,
		requireCapability: async (cap: string, scope?: { eventId?: string }) => {
			if (!(await can(cap, scope))) throw error(403, 'Not permitted');
			return { id: 'nia' };
		},
		getUserRoles: async () => [],
		committeeCapabilitiesFor: async () => [],
		topPositionFor: () => sql`null`
	};
});

const remote = (await import('./volunteer.remote')) as unknown as {
	getMyShift: (id: string) => PromiseLike<{ checkIn: { eventId: string } | null }>;
	getMyShiftCheckIn: (id: string) => PromiseLike<{ tickets: unknown[] }>;
	checkInAsVolunteer: (data: { ticketId: string; signupId: string }) => Promise<unknown>;
};

const now = Math.floor(Date.now() / 1000);
const HOUR = 3600;

function setUp(opts: { status: string; startsIn: number; grants: string[] }) {
	sqlite.exec(`
		insert into "user" (id, name, email) values ('nia', 'Nia', 'nia@example.com');
		insert into event_listing (id, title, starts_at, ends_at, status, created_by_user_id)
			values ('evt', 'Drum Circle', ${now + opts.startsIn}, ${now + opts.startsIn + 3 * HOUR}, 'published', 'nia');
		insert into ticket_sale (event_listing_id, enabled, price_cents) values ('evt', 1, 1000);
		insert into volunteer_role (id, name) values ('desk', 'Front Desk');
		insert into work_order (id, volunteer_role_id, event_id) values ('wo', 'desk', 'evt');
		insert into volunteer_shift (id, work_order_id, starts_at, ends_at, capacity)
			values ('sh', 'wo', ${now + opts.startsIn}, ${now + opts.startsIn + 3 * HOUR}, 2);
		insert into volunteer_signup (id, shift_id, user_id, status) values ('s1', 'sh', 'nia', '${opts.status}');
	`);
	for (const cap of opts.grants) {
		sqlite
			.prepare(
				`insert into volunteer_role_capability (volunteer_role_id, capability) values ('desk', ?)`
			)
			.run(cap);
	}
}

beforeEach(() => {
	for (const t of [
		'volunteer_signup',
		'volunteer_shift',
		'work_order',
		'volunteer_role_capability',
		'volunteer_role',
		'ticket_sale',
		'event_listing',
		'"user"'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
});

describe('the door list on a shift', () => {
	it('opens for a confirmed signup on a role granted check-in, during the shift', async () => {
		setUp({ status: 'confirmed', startsIn: -HOUR, grants: ['event.checkIn'] });
		expect((await remote.getMyShift('s1')).checkIn).toMatchObject({ eventId: 'evt' });
		expect((await remote.getMyShiftCheckIn('s1')).tickets).toEqual([]);
	});

	it.each([
		['a signup awaiting confirmation', { status: 'pending', startsIn: -HOUR }],
		['a shift two days out', { status: 'confirmed', startsIn: 48 * HOUR }],
		['a shift that ended', { status: 'confirmed', startsIn: -5 * HOUR }]
	])('stays shut for %s', async (_name, when) => {
		setUp({ ...when, grants: ['event.checkIn'] });
		expect((await remote.getMyShift('s1')).checkIn).toBeNull();
		await expect(remote.getMyShiftCheckIn('s1')).rejects.toMatchObject({ status: 403 });
		await expect(
			remote.checkInAsVolunteer({ ticketId: 't1', signupId: 's1' })
		).rejects.toMatchObject({ status: 403 });
	});

	it('stays shut for a role not granted check-in', async () => {
		setUp({ status: 'confirmed', startsIn: -HOUR, grants: ['incident.file'] });
		expect((await remote.getMyShift('s1')).checkIn).toBeNull();
		await expect(remote.getMyShiftCheckIn('s1')).rejects.toMatchObject({ status: 403 });
	});
});
