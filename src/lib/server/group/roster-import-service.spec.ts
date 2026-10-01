import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ROSTER_IMPORT_MAX } from '$lib/config';

/**
 * Staff roster import, against a real SQLite: which address lands in which
 * bucket is decided by `WHERE` clauses and a partial-index upsert, both of
 * which a mocked `db` would agree with either way.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

// better-sqlite3's drizzle has no `batch`; D1's runs the statements in order,
// as this does. It also enforces D1's 100-bound-parameter cap per statement,
// which SQLite itself does not.
const largestStatement = vi.hoisted(() => ({ params: 0 }));
vi.mock('$lib/server/db', () => ({
	db: Object.assign(testDb, {
		batch: async (stmts: (PromiseLike<unknown> & { toSQL(): { params: unknown[] } })[]) => {
			const out = [];
			for (const s of stmts) {
				const n = s.toSQL().params.length;
				if (n > 100) throw new Error(`D1 would reject ${n} bound parameters`);
				largestStatement.params = Math.max(largestStatement.params, n);
				out.push(await s);
			}
			return out;
		}
	})
}));

const emit = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: { emit: (...a: unknown[]) => emit(...a) }
}));
const audit = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('$lib/server/audit/audit-service', () => ({
	recordAuditEntry: (...a: unknown[]) => audit(...a)
}));

const { parseRosterImport, importRoster, RosterImportInputError, RosterImportGroupError } =
	await import('./roster-import-service');

const CLUB = 'grp-club';
const BAND = 'grp-band';
const STAFF = { id: 'usr-staff', name: 'Sam Staff' };
const DAY = 86_400;

async function seed() {
	const now = Math.floor(Date.now() / 1000);
	sqlite.exec(`
		insert into "group" (id, kind, name, slug, join_policy) values
			('${CLUB}', 'club', 'Jazz Club', 'jazz-club', 'by_application'),
			('${BAND}', 'band', 'A Band', 'a-band', 'invite_only');
		insert into user (id, name, email, email_verified, deleted_at) values
			('usr-staff', 'Sam Staff', 'staff@example.com', 0, null),
			('usr-new', 'Nia', 'nia@example.com', 0, null),
			('usr-member', 'Mo', 'mo@example.com', 0, null),
			('usr-pending', 'Pat', 'pat@example.com', 0, null),
			('usr-applicant', 'Ada', 'ada@example.com', 0, null),
			('usr-emailed', 'Eve', 'eve@example.com', 0, null),
			('usr-gone', 'Gil', 'gil@example.com', 0, ${now});
		insert into group_member (id, group_id, user_id, role, status) values
			('gm-member', '${CLUB}', 'usr-member', 'member', 'active'),
			('gm-pending', '${CLUB}', 'usr-pending', 'member', 'pending');
		insert into group_application (id, user_id, answers) values ('app-1', 'usr-applicant', '{}');
		insert into group_application_choice (id, application_id, group_id, status)
			values ('choice-1', 'app-1', '${CLUB}', 'submitted');
		insert into group_invite (id, email, token, group_id, role, status, expires_at) values
			('inv-eve', 'eve@example.com', 'tok-eve', '${CLUB}', 'member', 'pending', ${now + DAY}),
			('inv-live', 'live@example.com', 'tok-live', '${CLUB}', 'member', 'pending', ${now + DAY}),
			('inv-old', 'old@example.com', 'tok-old', '${CLUB}', 'member', 'pending', ${now - DAY});
	`);
}

beforeEach(async () => {
	emit.mockClear();
	audit.mockClear();
	for (const t of [
		'group_application_choice',
		'group_application',
		'group_invite',
		'group_member',
		'"group"',
		'user'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	await seed();
});

const roster = () =>
	sqlite
		.prepare(`select user_id, status from group_member where group_id = ? order by user_id`)
		.all(CLUB) as { user_id: string; status: string }[];

const invites = () =>
	sqlite
		.prepare(
			`select email, token, status, expires_at from group_invite where group_id = ? order by email`
		)
		.all(CLUB) as { email: string; token: string; status: string; expires_at: number }[];

describe('parseRosterImport', () => {
	it('splits on lines, commas and semicolons; trims, lowercases and dedupes', () => {
		const parsed = parseRosterImport(
			' A@Example.com, b@example.com;\nc@example.com\n\na@example.com '
		);
		expect(parsed).toEqual({
			emails: ['a@example.com', 'b@example.com', 'c@example.com'],
			invalid: [],
			duplicates: 1
		});
	});

	it('keeps each invalid line as typed', () => {
		const parsed = parseRosterImport('ok@example.com\nnot an email\nalso@bad');
		expect(parsed.emails).toEqual(['ok@example.com']);
		expect(parsed.invalid).toEqual(['not an email', 'also@bad']);
	});

	it('finds the address column in a Zeffy-shaped export, ignoring the rest', () => {
		// Quoted commas in a name and an address are why this is a real CSV parser.
		const csv = [
			'﻿"Payment Date","First Name","Last Name","Email","Email Opt-In","Amount","Address","Form Title"',
			'"2026-09-01","Ada","Lovelace, PhD","Ada@Example.com","Yes","25.00","1 Main St, Corvallis","Jazz Club dues"',
			'"2026-09-02","Bo","Diddley","bo@example.com","No","25.00","","Jazz Club dues"',
			'"2026-09-03","Cy","Young","","Yes","25.00","","Jazz Club dues"'
		].join('\r\n');
		expect(parseRosterImport('', csv)).toEqual({
			emails: ['ada@example.com', 'bo@example.com'],
			invalid: [],
			duplicates: 0
		});
	});

	it('matches the header case-insensitively and merges with pasted text', () => {
		const csv = 'name,E-MAIL ADDRESS\nX,x@example.com\nY,y@example.com';
		expect(parseRosterImport('x@example.com', csv).emails).toEqual([
			'x@example.com',
			'y@example.com'
		]);
	});

	it('refuses a CSV with no email column', () => {
		expect(() => parseRosterImport('', 'name,amount\nAda,25')).toThrow(RosterImportInputError);
	});

	it('refuses an empty submission', () => {
		expect(() => parseRosterImport(' \n , ')).toThrow(RosterImportInputError);
	});

	it(`caps a batch at ${ROSTER_IMPORT_MAX} distinct addresses`, () => {
		const list = (n: number) => Array.from({ length: n }, (_, i) => `m${i}@example.com`).join('\n');
		expect(parseRosterImport(list(ROSTER_IMPORT_MAX)).emails).toHaveLength(ROSTER_IMPORT_MAX);
		// Duplicates do not count toward it.
		expect(() => parseRosterImport(`${list(ROSTER_IMPORT_MAX)}\nm0@example.com`)).not.toThrow();
		expect(() => parseRosterImport(list(ROSTER_IMPORT_MAX + 1))).toThrow(/more than the 500/);
	});
});

describe('importRoster', () => {
	const run = (text: string) => importRoster(CLUB, parseRosterImport(text), STAFF);

	it('adds an existing account straight onto the roster as active', async () => {
		const result = await run('NIA@example.com');
		expect(result.added).toEqual(['nia@example.com']);
		expect(roster()).toContainEqual({ user_id: 'usr-new', status: 'active' });
		expect(emit).toHaveBeenCalledTimes(1);
		expect(emit).toHaveBeenCalledWith('group.members_added', {
			groupId: CLUB,
			userIds: ['usr-new'],
			addedById: STAFF.id
		});
	});

	// Activated pending rows and accepted applications were added without their
	// own action too, so they are told; an existing member is not.
	it('announces everyone added directly in one event, and no one already a member', async () => {
		await run(
			['mo@example.com', 'nia@example.com', 'pat@example.com', 'ada@example.com'].join('\n')
		);
		const added = emit.mock.calls.filter(([name]) => name === 'group.members_added');
		expect(added).toHaveLength(1);
		expect(added[0][1]).toEqual({
			groupId: CLUB,
			userIds: ['usr-new', 'usr-pending', 'usr-applicant'],
			addedById: STAFF.id
		});
	});

	it('invites an unknown address, one batched event carrying its token', async () => {
		const result = await run('stranger@example.com');
		expect(result.invited).toEqual(['stranger@example.com']);
		const row = invites().find((i) => i.email === 'stranger@example.com');
		expect(row?.status).toBe('pending');
		expect(emit).toHaveBeenCalledTimes(1);
		expect(emit).toHaveBeenCalledWith('group_invite.bulk_created', {
			groupId: CLUB,
			groupName: 'Jazz Club',
			groupKind: 'club',
			role: 'member',
			invitedByName: 'Sam Staff',
			invites: [{ email: 'stranger@example.com', token: row?.token }]
		});
	});

	it('reports every bucket, leaving members and live invitations alone', async () => {
		const result = await run(
			[
				'mo@example.com',
				'live@example.com',
				'gil@example.com',
				'nope',
				'nia@example.com',
				'nia@example.com'
			].join('\n')
		);
		expect(result).toEqual({
			added: ['nia@example.com'],
			invited: [],
			alreadyMembers: ['mo@example.com'],
			alreadyInvited: ['live@example.com'],
			invalid: [
				{ entry: 'nope', reason: 'Not an email address' },
				{ entry: 'gil@example.com', reason: 'Account is deactivated' }
			],
			duplicates: 1
		});
		expect(roster()).not.toContainEqual(expect.objectContaining({ user_id: 'usr-gone' }));
		expect(invites().find((i) => i.email === 'live@example.com')?.token).toBe('tok-live');
		expect(emit.mock.calls.map(([name]) => name)).toEqual(['group.members_added']);
	});

	it('refreshes an expired invitation in place and re-sends it, same token', async () => {
		const before = invites().find((i) => i.email === 'old@example.com')!;
		const result = await run('old@example.com');
		expect(result.invited).toEqual(['old@example.com']);
		const after = invites().filter((i) => i.email === 'old@example.com');
		expect(after).toHaveLength(1);
		expect(after[0].token).toBe('tok-old');
		expect(after[0].expires_at).toBeGreaterThan(before.expires_at);
		expect(emit).toHaveBeenCalledWith(
			'group_invite.bulk_created',
			expect.objectContaining({ invites: [{ email: 'old@example.com', token: 'tok-old' }] })
		);
	});

	it('activates a pending roster row instead of adding a second', async () => {
		expect((await run('pat@example.com')).added).toEqual(['pat@example.com']);
		expect(emit).not.toHaveBeenCalledWith('group_invite.bulk_created', expect.anything());
		expect(roster().filter((r) => r.user_id === 'usr-pending')).toEqual([
			{ user_id: 'usr-pending', status: 'active' }
		]);
	});

	it('settles an open application as accepted by the importer', async () => {
		await run('ada@example.com');
		expect(roster()).toContainEqual({ user_id: 'usr-applicant', status: 'active' });
		expect(
			sqlite
				.prepare(`select status, decided_by_user_id from group_application_choice where id = ?`)
				.get('choice-1')
		).toEqual({ status: 'accepted', decided_by_user_id: 'usr-staff' });
	});

	it('marks an emailed invitation to an account holder accepted', async () => {
		expect((await run('eve@example.com')).added).toEqual(['eve@example.com']);
		expect(invites().find((i) => i.email === 'eve@example.com')?.status).toBe('accepted');
	});

	it('chunks a large batch under D1’s bound-parameter cap', async () => {
		const many = Array.from({ length: 120 }, (_, i) => `new${i}@example.com`);
		const values = Array.from({ length: 120 }, (_, i) =>
			i % 2 ? `('u${i}', 'U${i}', 'new${i}@example.com', 0)` : null
		).filter(Boolean);
		sqlite.exec(`insert into user (id, name, email, email_verified) values ${values.join(',')}`);

		const result = await run(many.join('\n'));
		expect(result.added).toHaveLength(60);
		expect(result.invited).toHaveLength(60);
		const sent = emit.mock.calls.find(([n]) => n === 'group_invite.bulk_created')![1] as {
			invites: unknown[];
		};
		expect(sent.invites).toHaveLength(60);
		const added = emit.mock.calls.find(([n]) => n === 'group.members_added')![1] as {
			userIds: unknown[];
		};
		expect(added.userIds).toHaveLength(60);
		expect(largestStatement.params).toBeGreaterThan(50);
	});

	it('records one audit entry, counts only', async () => {
		await run('nia@example.com\nstranger@example.com');
		expect(audit).toHaveBeenCalledWith({
			action: 'group.roster_imported',
			subject: { type: 'group', id: CLUB, label: 'Jazz Club' },
			details: { added: 1, invited: 1, alreadyMembers: 0, alreadyInvited: 0, invalid: 0 }
		});
	});

	it('announces nothing when nobody was added', async () => {
		await run('mo@example.com');
		expect(emit).not.toHaveBeenCalled();
	});

	it('refuses a band', async () => {
		await expect(
			importRoster(BAND, parseRosterImport('nia@example.com'), STAFF)
		).rejects.toBeInstanceOf(RosterImportGroupError);
	});
});
