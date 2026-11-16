import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';

/**
 * #3028: a member is cleared for the room by their own clearance, or by an
 * active place in a live band where another active member holds one. Real
 * SQLite, so the async decision and the SQL form answer from the same rows.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});
vi.mock('#lib/server/db/index.js', () => ({ db: testDb, getRowCount: () => 0 }));

const { practiceSpaceClearance, clearedForPracticeSpaceSql, recordClearedThroughBand } =
	await import('./practice-space-clearance');

const NOW = new Date('2026-07-13T17:00:00Z');
const sec = (d: Date) => Math.floor(d.getTime() / 1000);

function grant(userId: string, opts: { revokedAt?: Date } = {}) {
	sqlite
		.prepare(
			`insert into member_certification (id, user_id, certification_id, granted_at, revoked_at, revoked_reason)
			 values (?, ?, 'practice-space', ?, ?, ?)`
		)
		.run(
			crypto.randomUUID(),
			userId,
			sec(NOW) - 86400,
			opts.revokedAt ? sec(opts.revokedAt) : null,
			opts.revokedAt ? 'Wrong member' : null
		);
}

function band(id: string, opts: { kind?: string; deleted?: boolean } = {}) {
	sqlite
		.prepare(`insert into "group" (id, kind, name, slug, deleted_at) values (?, ?, ?, ?, ?)`)
		.run(id, opts.kind ?? 'band', `Band ${id}`, id, opts.deleted ? sec(NOW) : null);
}

function join(groupId: string, userId: string, status = 'active') {
	sqlite
		.prepare(
			`insert into group_member (id, group_id, user_id, role, status) values (?, ?, ?, 'member', ?)`
		)
		.run(crypto.randomUUID(), groupId, userId, status);
}

/** The SQL form, correlated to a `user` row the way the reminder reads use it. */
async function clearedInSql(userId: string): Promise<boolean> {
	const { user } = await import('#lib/server/db/schema/authentication.js');
	const [row] = await testDb
		.select({ ok: sql<number>`${clearedForPracticeSpaceSql(user.id, NOW)}` })
		.from(user)
		.where(sql`${user.id} = ${userId}`);
	return Boolean(row?.ok);
}

async function both(userId: string) {
	const cleared = await practiceSpaceClearance(userId, NOW);
	return { via: cleared?.via ?? null, sql: await clearedInSql(userId), cleared };
}

beforeEach(() => {
	sqlite.exec(
		'delete from member_certification; delete from group_member; delete from "group"; delete from user; delete from audit_log;'
	);
	sqlite.exec(
		`insert into user (id, name, email) values
			('u-new', 'New', 'new@x.test'), ('u-mate', 'Mate', 'mate@x.test'),
			('u-other', 'Other', 'other@x.test')`
	);
});

describe('practiceSpaceClearance', () => {
	it('clears a member who holds their own', async () => {
		grant('u-new');
		expect(await both('u-new')).toMatchObject({ via: 'own', sql: true });
	});

	it('clears an active member of a live band whose bandmate holds it', async () => {
		band('b1');
		join('b1', 'u-new');
		join('b1', 'u-mate');
		grant('u-mate');
		const r = await both('u-new');
		expect(r).toMatchObject({ via: 'band', sql: true });
		expect(r.cleared).toMatchObject({ groupId: 'b1', bandmateUserId: 'u-mate' });
	});

	it('does not clear a member with no clearance and no band', async () => {
		grant('u-other');
		expect(await both('u-new')).toMatchObject({ via: null, sql: false });
	});

	it.each([
		['the member is only invited', { mine: 'pending', mate: 'active' }],
		['the bandmate is only invited', { mine: 'active', mate: 'pending' }]
	])('does not clear when %s', async (_, s) => {
		band('b1');
		join('b1', 'u-new', s.mine);
		join('b1', 'u-mate', s.mate);
		grant('u-mate');
		expect(await both('u-new')).toMatchObject({ via: null, sql: false });
	});

	it('does not clear through a deactivated band', async () => {
		band('b1', { deleted: true });
		join('b1', 'u-new');
		join('b1', 'u-mate');
		grant('u-mate');
		expect(await both('u-new')).toMatchObject({ via: null, sql: false });
	});

	it('does not clear through a group that is not a band', async () => {
		band('c1', { kind: 'committee' });
		join('c1', 'u-new');
		join('c1', 'u-mate');
		grant('u-mate');
		expect(await both('u-new')).toMatchObject({ via: null, sql: false });
	});

	it("does not clear through a bandmate's revoked clearance", async () => {
		band('b1');
		join('b1', 'u-new');
		join('b1', 'u-mate');
		grant('u-mate', { revokedAt: new Date(NOW.getTime() - 60_000) });
		expect(await both('u-new')).toMatchObject({ via: null, sql: false });
	});

	it('writes no certification row for the band path', async () => {
		band('b1');
		join('b1', 'u-new');
		join('b1', 'u-mate');
		grant('u-mate');
		await practiceSpaceClearance('u-new', NOW);
		const rows = sqlite.prepare(`select 1 from member_certification where user_id = 'u-new'`).all();
		expect(rows).toHaveLength(0);
	});
});

describe('recordClearedThroughBand', () => {
	it('records the band and bandmate once per booking', async () => {
		const booking = {
			reservationId: 'r-1',
			userId: 'u-new',
			userName: 'New',
			date: '2026-07-15',
			startTime: '12:00',
			endTime: '13:00'
		};
		const through = {
			groupId: 'b1',
			groupName: 'Band b1',
			bandmateUserId: 'u-mate',
			bandmateName: 'Mate'
		};
		await recordClearedThroughBand(booking, through);
		await recordClearedThroughBand(booking, through);
		const rows = sqlite
			.prepare(`select subject_id as subject, details from audit_log where action = ?`)
			.all('reservation.cleared_through_band') as { subject: string; details: string }[];
		expect(rows).toHaveLength(1);
		expect(rows[0].subject).toBe('u-new');
		expect(JSON.parse(rows[0].details)).toMatchObject({
			reservationId: 'r-1',
			groupId: 'b1',
			bandmateUserId: 'u-mate'
		});
	});
});
