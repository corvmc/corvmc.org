import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';

/**
 * The class (#3204): a door check-in path that drops `checkIn`'s `alreadyIn`,
 * so a reused ticket reads as a fresh admission. Every remote that calls the
 * service runs here against a ticket already in, on a real SQLite. Guards are
 * waved through: who may check in is tested beside each remote.
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

vi.mock('#lib/server/authorization.js', () => ({
	requireUser: () => ({ id: 'nia' }),
	can: async () => true,
	requireCapability: async () => ({ id: 'nia' }),
	getUserRoles: async () => [],
	committeeCapabilitiesFor: async () => [],
	positionsFor: async () => [],
	capabilitySet: () => [],
	topPositionFor: () => sql`null`
}));

vi.mock('#lib/server/group/group-context.js', async (orig) => ({
	...(await orig<object>()),
	requireGroupRole: async () => ({ user: { id: 'nia' }, group: { id: 'band-1' }, role: 'admin' })
}));

vi.mock('#lib/server/event/event-service.js', async (orig) => ({
	...(await orig<object>()),
	getById: async (id: string) => ({ id, groupId: 'band-1' })
}));

type Call = (data: Record<string, string>, issue?: unknown) => Promise<unknown>;
type Remotes = Record<string, Call>;
const events = (await import('./events.remote')) as unknown as Remotes;
const volunteer = (await import('./volunteer.remote')) as unknown as Remotes;
const band = (await import('./band-ticket-sale.remote')) as unknown as Remotes;

const ticket = { ticketId: 't-1' };
/** Every remote that checks a ticket in, keyed `file:export`, with its own arguments. */
const PATHS: Record<string, () => Promise<unknown>> = {
	'events:scanTicketIn': () => events.scanTicketIn({ ...ticket, eventId: 'evt' }),
	'events:checkInTicket': () => events.checkInTicket({ ...ticket, eventId: 'evt' }),
	'volunteer:scanTicketInAsVolunteer': () =>
		volunteer.scanTicketInAsVolunteer({ ...ticket, signupId: 's1' }),
	'volunteer:checkInAsVolunteer': () => volunteer.checkInAsVolunteer({ ...ticket, signupId: 's1' }),
	'band-ticket-sale:checkInBandTicket': () =>
		band.checkInBandTicket({ ...ticket, slug: 'our-band', eventId: 'evt' })
};

const now = Math.floor(Date.now() / 1000);
const earlier = now - 600;

beforeEach(() => {
	for (const t of [
		'ticket',
		'volunteer_signup',
		'volunteer_shift',
		'work_order',
		'volunteer_role',
		'event_listing',
		'"user"'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	sqlite.exec(`
		insert into "user" (id, name, email) values ('nia', 'Nia', 'nia@example.com');
		insert into event_listing (id, title, starts_at, ends_at, status, created_by_user_id)
			values ('evt', 'Drum Circle', ${now}, ${now + 10800}, 'published', 'nia');
		insert into volunteer_role (id, name) values ('door', 'Door');
		insert into work_order (id, volunteer_role_id, event_id) values ('wo', 'door', 'evt');
		insert into volunteer_shift (id, work_order_id, starts_at, ends_at, capacity)
			values ('sh', 'wo', ${now}, ${now + 10800}, 2);
		insert into volunteer_signup (id, shift_id, user_id, status) values ('s1', 'sh', 'nia', 'confirmed');
		insert into ticket (id, event_id, purchase_id, attendee_name, attendee_email, code, status, checked_in_at)
			values ('t-1', 'evt', 'pur-1', 'Guest', 'g@example.com', 'TIX-1', 'checked_in', ${earlier});
	`);
});

describe('a ticket already checked in', () => {
	it.each(Object.keys(PATHS))('%s reports it, with the first time', async (path) => {
		expect(await PATHS[path]()).toMatchObject({
			alreadyIn: true,
			checkedInAt: new Date(earlier * 1000)
		});
	});
});

describe('the list of check-in paths', () => {
	// A new remote that calls `checkIn` has to join PATHS, or this fails.
	it('names every remote export that calls the check-in service', () => {
		const dir = import.meta.dirname;
		const found: string[] = [];
		for (const file of readdirSync(dir).filter((f) => /^[\w-]+\.remote\.ts$/.test(f))) {
			const src = readFileSync(join(dir, file), 'utf8');
			const imported =
				/import\s*{([^}]*)}\s*from\s*'#lib\/server\/ticket\/ticket-service\.js'/.exec(src)?.[1];
			const alias = imported
				?.split(',')
				.map((s) => s.trim())
				.find((s) => /^checkIn\b/.test(s))
				?.split(/\s+as\s+/)
				.at(-1);
			if (!alias) continue;
			for (const [, name, body] of src.matchAll(
				/export const (\w+) =([\s\S]*?)(?=\nexport |\n\/\*\*|$)/g
			)) {
				if (new RegExp(`\\b${alias}\\(`).test(body))
					found.push(`${file.replace('.remote.ts', '')}:${name}`);
			}
		}
		expect(found.sort()).toEqual(Object.keys(PATHS).sort());
	});

	// The page half: a row that renders a check-in form through bare `Form`
	// shows the success toast for a repeat. `DoorCheckInForm` reads `alreadyIn`.
	it('renders every check-in form through DoorCheckInForm', () => {
		const forms = ['checkInTicket', 'checkInAsVolunteer', 'checkInBandTicket'];
		const bare: string[] = [];
		const walk = (dir: string): void => {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				const path = join(dir, entry.name);
				if (entry.isDirectory()) walk(path);
				else if (entry.name.endsWith('.svelte')) {
					const src = readFileSync(path, 'utf8');
					const used = forms.some((f) => src.includes(`${f}.for(`));
					if (used && !/<DoorCheckInForm\b/.test(src)) bare.push(path);
				}
			}
		};
		walk(join(import.meta.dirname, '../..'));
		expect(bare).toEqual([]);
	});
});
