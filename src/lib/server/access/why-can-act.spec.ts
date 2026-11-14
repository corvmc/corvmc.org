import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * A person's "why" (#2994) against the guard it explains, on a real SQLite:
 * for every capability, user and scope in the fixture, `userHasCapability`
 * says yes exactly when `explainAccess` lists a position, department grant or
 * live shift role that covers it.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('$app/server', () => ({ getRequestEvent: () => ({ locals: {} }) }));

const { explainAccess } = await import('./why-can-act');
const { userHasCapability } = await import('#lib/server/authorization.js');
const { seatSql } = await import('#lib/server/testing/operations-seat.js');
const { capabilities } = await import('#lib/config.js');
type Capability = import('#lib/config.js').Capability;
type CapabilityScope = import('#lib/server/authorization.js').CapabilityScope;
type AccessExplanation = import('./why-can-act').AccessExplanation;

const NOW = new Date('2026-12-01T12:00:00Z');
const DAY = 86_400_000;
const secs = (d: Date) => Math.floor(d.getTime() / 1000);

const everyCapability = Object.entries(capabilities).flatMap(([r, as]) =>
	(as as readonly string[]).map((a) => `${r}.${a}` as Capability)
);
const users = ['ana', 'ben', 'cy'];
const scopes: (CapabilityScope | undefined)[] = [
	undefined,
	{ groupId: 'booking' },
	{ groupId: 'sound' },
	{ eventId: 'soon' },
	{ eventId: 'later' }
];

/** Does the explanation account for `cap` under `scope`, the way each guard route reads it? */
function covers(why: AccessExplanation, cap: Capability, scope?: CapabilityScope): boolean {
	if (why.positions.some((p) => p.capabilities.includes(cap))) return true;
	const byDepartment = why.departments.some((d) =>
		d.grants.some(
			(g) => g.capability === cap && (g.reach === 'org' || d.groupId === scope?.groupId)
		)
	);
	if (byDepartment) return true;
	return why.shiftRoles.some((r) => r.eventId === scope?.eventId && r.capabilities.includes(cap));
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	sqlite.exec(`
		insert into "user" (id, name, email) values
			('ana', 'Ana', 'ana@example.com'), ('ben', 'Ben', 'ben@example.com'),
			('cy', 'Cy', 'cy@example.com');
		insert into "group" (id, kind, name, slug, join_policy) values
			('booking', 'committee', 'Booking', 'booking', 'invite_only'),
			('sound', 'committee', 'Sound', 'sound', 'invite_only');
		insert into group_member (id, group_id, user_id, role, status) values
			('m1', 'booking', 'ana', 'member', 'active'),
			('m2', 'sound', 'ben', 'member', 'active'),
			('m3', 'sound', 'cy', 'member', 'inactive');
		insert into group_capability (group_id, capability) values
			('booking', 'sponsor.read'), ('booking', 'volunteer.manageShifts'),
			('sound', 'grant.read');
		insert into group_position (id, group_id, name, is_chair) values
			('chair', 'booking', 'Chair', 1), ('booker', 'booking', 'Booker', 0);
		insert into group_position_holder (position_id, member_id) values
			('chair', 'm1'), ('booker', 'm1');
		insert into event_listing (id, title, starts_at, ends_at, status, source, kind, created_by_user_id) values
			('soon', 'Market soon', ${secs(new Date(NOW.getTime() + 5 * DAY))}, ${secs(new Date(NOW.getTime() + 5 * DAY + 3_600_000))}, 'published', 'cmc', 'market', 'ana'),
			('later', 'Market later', ${secs(new Date(NOW.getTime() + 60 * DAY))}, ${secs(new Date(NOW.getTime() + 60 * DAY + 3_600_000))}, 'published', 'cmc', 'market', 'ana');
		insert into volunteer_role (id, name, grant_lead_days) values ('host', 'Vendor host', 30);
		insert into volunteer_role_capability (volunteer_role_id, capability) values
			('host', 'market.host'), ('host', 'event.checkIn');
		insert into work_order (id, volunteer_role_id, event_id) values
			('host-soon', 'host', 'soon'), ('host-later', 'host', 'later');
		insert into work_order_assignee (work_order_id, user_id) values
			('host-soon', 'ben'), ('host-later', 'ben');
	`);
	sqlite.exec(seatSql('cy', 'treasurer'));
});

afterEach(() => {
	vi.useRealTimers();
	for (const t of [
		'work_order_assignee',
		'work_order',
		'volunteer_role_capability',
		'volunteer_role',
		'event_listing',
		'group_position_holder',
		'group_capability',
		'group_member'
	])
		sqlite.exec(`delete from ${t}`);
	sqlite.exec(`delete from group_position where group_id != 'operations'`);
	sqlite.exec(`delete from "group" where id != 'operations'`);
	sqlite.exec(`delete from "user"`);
});

describe('explainAccess', () => {
	it('lists departments with the positions held there, chair first', async () => {
		const why = await explainAccess('ana', NOW);
		expect(why.departments.map((d) => [d.groupId, d.positions])).toEqual([
			['booking', ['Chair', 'Booker']]
		]);
	});

	it('lists a shift role only while its grant is live', async () => {
		const why = await explainAccess('ben', NOW);
		expect(why.shiftRoles.map((r) => r.eventId)).toEqual(['soon']);
	});

	it('lists an Operations seat as a position, not a department', async () => {
		const why = await explainAccess('cy', NOW);
		expect(why.positions.map((p) => p.position)).toEqual(['treasurer']);
		expect(why.departments).toEqual([]);
	});

	it('accounts for exactly what the guard admits, for every capability and scope', async () => {
		for (const userId of users) {
			const why = await explainAccess(userId, NOW);
			for (const scope of scopes) {
				for (const cap of everyCapability) {
					const admitted = await userHasCapability(userId, cap, scope);
					expect(
						[userId, cap, scope, covers(why, cap, scope)],
						'explanation disagrees with the guard'
					).toEqual([userId, cap, scope, admitted]);
				}
			}
		}
	});
});
