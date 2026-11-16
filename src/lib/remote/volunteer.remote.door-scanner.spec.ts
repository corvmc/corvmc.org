import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';

/**
 * The scanner on a volunteer's door list (#2795, #2797), through the remotes, against a
 * real SQLite and the real role-grant resolver. Scoped by the signup, as the list is.
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
		positionsFor: async () => [],
		capabilitySet: () => [],
		topPositionFor: () => sql`null`
	};
});

type Result = { alreadyIn: boolean; checkedInAt: Date };
const remote = (await import('./volunteer.remote')) as unknown as {
	getMyShiftCheckIn: (
		id: string
	) => PromiseLike<{ tickets: { code: string; status: string; cancelledAt: Date | null }[] }>;
	scanTicketInAsVolunteer: (d: { ticketId: string; signupId: string }) => Promise<Result>;
	identifyTicketCodeAsVolunteer: (d: {
		code: string;
		signupId: string;
	}) => Promise<{ eventTitle: string; startsAt: Date } | null>;
};

const now = Math.floor(Date.now() / 1000);
const HOUR = 3600;

function listing(id: string, title: string, startsAt: number) {
	sqlite.exec(`
		insert into event_listing (id, title, starts_at, ends_at, status, created_by_user_id)
			values ('${id}', '${title}', ${startsAt}, ${startsAt + 3 * HOUR}, 'published', 'nia');
		insert into ticket_sale (event_listing_id, enabled, price_cents) values ('${id}', 1, 1000);
	`);
}

function ticketRow(id: string, eventId: string, code: string, status: string) {
	sqlite.exec(`
		insert into ticket (id, event_id, purchase_id, attendee_name, attendee_email, code, status)
			values ('${id}', '${eventId}', 'pur-${id}', 'Guest ${id}', '${id}@example.com', '${code}', '${status}')
	`);
}

function setUp(opts: { startsIn: number } = { startsIn: -HOUR }) {
	sqlite.exec(`insert into "user" (id, name, email) values ('nia', 'Nia', 'nia@example.com')`);
	listing('evt', 'Drum Circle', now + opts.startsIn);
	listing('fri', 'Friday Show', now + 48 * HOUR);
	sqlite.exec(`
		insert into volunteer_role (id, name) values ('door', 'Door');
		insert into volunteer_role_capability (volunteer_role_id, capability) values ('door', 'event.checkIn');
		insert into work_order (id, volunteer_role_id, event_id) values ('wo', 'door', 'evt');
		insert into volunteer_shift (id, work_order_id, starts_at, ends_at, capacity)
			values ('sh', 'wo', ${now + opts.startsIn}, ${now + opts.startsIn + 3 * HOUR}, 2);
		insert into volunteer_signup (id, shift_id, user_id, status) values ('s1', 'sh', 'nia', 'confirmed');
	`);
	ticketRow('t-ok', 'evt', 'TIX-OK', 'valid');
	ticketRow('t-gone', 'evt', 'TIX-GONE', 'cancelled');
	ticketRow('t-fri', 'fri', 'TIX-FRI', 'valid');
}

beforeEach(() => {
	for (const t of [
		'ticket',
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

describe("the volunteer's door scanner", () => {
	// The class: a door list filtered before it reaches the page, so a miss
	// cannot say why. A cancelled ticket stays in, marked (#2797).
	it('keeps a cancelled ticket on the list, with when it was cancelled', async () => {
		setUp();
		const { tickets } = await remote.getMyShiftCheckIn('s1');
		const gone = tickets.find((t) => t.code === 'TIX-GONE');
		expect(gone).toMatchObject({ status: 'cancelled' });
		expect(gone?.cancelledAt).toBeInstanceOf(Date);
		expect(tickets.find((t) => t.code === 'TIX-OK')?.cancelledAt).toBeNull();
	});

	it("checks in a ticket on the shift's show and reports a repeat", async () => {
		setUp();
		const first = await remote.scanTicketInAsVolunteer({ ticketId: 't-ok', signupId: 's1' });
		expect(first.alreadyIn).toBe(false);
		const again = await remote.scanTicketInAsVolunteer({ ticketId: 't-ok', signupId: 's1' });
		expect(again.alreadyIn).toBe(true);
	});

	it("refuses another show's ticket", async () => {
		setUp();
		await expect(
			remote.scanTicketInAsVolunteer({ ticketId: 't-fri', signupId: 's1' })
		).rejects.toMatchObject({ status: 403 });
	});

	it('refuses outside the shift', async () => {
		setUp({ startsIn: 48 * HOUR });
		await expect(
			remote.scanTicketInAsVolunteer({ ticketId: 't-ok', signupId: 's1' })
		).rejects.toMatchObject({ status: 403 });
		await expect(
			remote.identifyTicketCodeAsVolunteer({ code: 'TIX-FRI', signupId: 's1' })
		).rejects.toMatchObject({ status: 403 });
	});

	it('names the other show a code is for, and nothing for an unknown or own code', async () => {
		setUp();
		await expect(
			remote.identifyTicketCodeAsVolunteer({ code: 'tix-fri', signupId: 's1' })
		).resolves.toMatchObject({ eventTitle: 'Friday Show' });
		await expect(
			remote.identifyTicketCodeAsVolunteer({ code: 'NOTATICKET', signupId: 's1' })
		).resolves.toBeNull();
		await expect(
			remote.identifyTicketCodeAsVolunteer({ code: 'TIX-OK', signupId: 's1' })
		).resolves.toBeNull();
	});
});
