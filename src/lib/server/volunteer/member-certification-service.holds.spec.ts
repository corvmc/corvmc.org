import { describe, it, expect, beforeAll, vi } from 'vitest';

/**
 * The roster's Clearance filter (#1934), against a real SQLite: a mocked `db`
 * agrees with an EXISTS whether or not it is correlated.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { holdsCertificationSql } = await import('./member-certification-service');
const { user } = await import('$lib/server/db/schema/authentication');
const { db } = await import('$lib/server/db');

const AT = new Date('2026-10-15T19:00:00Z');
const s = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

beforeAll(() => {
	sqlite.exec(
		`insert into user (id, name, email) values
			('current', 'Current', 'c@x'), ('expired', 'Expired', 'e@x'),
			('revoked', 'Revoked', 'r@x'), ('other', 'Other cert', 'o@x'),
			('future', 'Not yet', 'f@x'), ('none', 'Nothing', 'n@x')`
	);
	const grant = (
		id: string,
		userId: string,
		cert: string,
		extra = 'null, null, null',
		from = '2026-01-01'
	) => `('${id}', '${userId}', '${cert}', ${s(from)}, ${extra})`;
	sqlite.exec(
		`insert into member_certification (id, user_id, certification_id, granted_at, expires_at, revoked_at, revoked_reason) values
			${grant('g1', 'current', 'food', `${s('2027-01-01')}, null, null`)},
			${grant('g2', 'expired', 'food', `${s('2026-10-01')}, null, null`)},
			${grant('g3', 'revoked', 'food', `null, ${s('2026-10-10')}, 'lapsed'`)},
			${grant('g4', 'other', 'sound')},
			${grant('g5', 'future', 'food', 'null, null, null', '2026-11-01')}`
	);
});

describe('holdsCertificationSql', () => {
	it('matches only people with a grant of that clearance in force', async () => {
		const rows = await db
			.select({ id: user.id })
			.from(user)
			.where(holdsCertificationSql('food', AT));

		expect(rows.map((r) => r.id)).toEqual(['current']);
	});
});
