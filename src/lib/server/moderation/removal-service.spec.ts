import { describe, it, expect, vi, beforeEach } from 'vitest';

// Removals against a real SQLite: the partial unique index is the guard
// against two open removals, and only a database can show it holding.
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));

const {
	recordRemoval,
	liftOpenRemoval,
	getOpenRemoval,
	listRemovals,
	RemovalAlreadyOpenError,
	RemovalWithoutReportError
} = await import('./removal-service');

const ledger = { reservationIds: [], doorCodeIds: [], billing: 'none' as const };

function seed() {
	for (const [id, name] of [
		['u1', 'Member'],
		['staff', 'Staffer']
	]) {
		sqlite
			.prepare(
				`insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 0, 0, 0)`
			)
			.run(id, name, `${id}@example.com`);
	}
	sqlite
		.prepare(
			`insert into content_flag (id, entity_type, entity_id, reason, origin, status) values ('f1', 'member_profile', 'u1', 'x', 'staff_action', 'resolved')`
		)
		.run();
}

beforeEach(() => {
	sqlite.exec('delete from account_removal; delete from content_flag; delete from user;');
	seed();
});

const base = { userId: 'u1', actorUserId: 'staff', reason: 'Threats', flagId: 'f1', ledger };

describe('recordRemoval', () => {
	it('refuses a second open removal of the same member', async () => {
		await recordRemoval({ ...base, kind: 'ban' });
		await expect(recordRemoval({ ...base, kind: 'ban' })).rejects.toBeInstanceOf(
			RemovalAlreadyOpenError
		);
	});

	it('allows a new removal once the last one is lifted', async () => {
		await recordRemoval({ ...base, kind: 'ban' });
		await liftOpenRemoval('u1', { liftedByUserId: 'staff', liftReason: 'staff_lifted' });
		await expect(recordRemoval({ ...base, kind: 'ban' })).resolves.toMatchObject({ kind: 'ban' });
	});

	it('refuses a removal with no report behind it', async () => {
		await expect(recordRemoval({ ...base, flagId: '', kind: 'ban' })).rejects.toBeInstanceOf(
			RemovalWithoutReportError
		);
	});

	it('keeps a term only on a suspension', async () => {
		const endsAt = new Date('2027-01-01T00:00:00Z');
		const ban = await recordRemoval({ ...base, kind: 'ban', endsAt });
		expect(ban.endsAt).toBeNull();
	});
});

describe('liftOpenRemoval', () => {
	it('stamps who lifted it and why, and leaves nothing open', async () => {
		await recordRemoval({ ...base, kind: 'ban' });
		const lifted = await liftOpenRemoval('u1', {
			liftedByUserId: 'staff',
			liftReason: 'appeal_granted'
		});
		expect(lifted).toMatchObject({ liftReason: 'appeal_granted', liftedByUserId: 'staff' });
		expect(await getOpenRemoval('u1')).toBeNull();
	});

	it('returns null when nothing is open', async () => {
		await expect(
			liftOpenRemoval('u1', { liftedByUserId: null, liftReason: 'staff_lifted' })
		).resolves.toBeNull();
	});
});

describe('listRemovals', () => {
	it('names the actor and the lifter', async () => {
		await recordRemoval({ ...base, kind: 'ban' });
		await liftOpenRemoval('u1', { liftedByUserId: 'staff', liftReason: 'staff_lifted' });
		const [row] = await listRemovals('u1');
		expect(row).toMatchObject({ actorName: 'Staffer', liftedByName: 'Staffer', kind: 'ban' });
	});
});
