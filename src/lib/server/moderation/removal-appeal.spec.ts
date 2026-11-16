import { describe, it, expect, vi, beforeEach } from 'vitest';

// The appeal a removed member files from the link in their notice, against a
// real SQLite: it attaches to the removal's report, so one report admits one
// appeal, and the notice they read never carries the staff reason.
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));
const emit = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock('#lib/server/event-bus/event-bus.js', () => ({
	domainEvents: { emit: (...a: unknown[]) => emit(...a) }
}));

const { fileRemovalAppeal, AppealAlreadyFiledError, AppealNotFoundError } =
	await import('./appeal-service');
const { getRemovalNotice } = await import('./removal-service');

beforeEach(() => {
	sqlite.exec(`
		delete from moderation_appeal; delete from account_removal; delete from content_flag; delete from user;
		insert into user (id, name, email, email_verified, created_at, updated_at)
			values ('m1', 'Member', 'm1@example.com', 1, 0, 0);
		insert into content_flag (id, entity_type, entity_id, reason, origin, status)
			values ('f1', 'member_profile', 'm1', 'Threats in the lobby', 'staff_action', 'resolved');
		insert into account_removal (id, user_id, kind, reason, flag_id, ends_at)
			values ('r1', 'm1', 'suspension', 'Threats in the lobby', 'f1', 1900000000);
	`);
	emit.mockClear();
});

describe('fileRemovalAppeal', () => {
	it('files against the removal report and tells staff', async () => {
		await fileRemovalAppeal({ removalId: 'r1', body: 'It was a misunderstanding' });
		expect(
			sqlite.prepare('select flag_id, appellant_user_id from moderation_appeal').get()
		).toEqual({ flag_id: 'f1', appellant_user_id: 'm1' });
		expect(emit).toHaveBeenCalledWith('moderation.appeal_filed', {
			flagId: 'f1',
			appellantName: 'Member'
		});
	});

	it('admits one appeal per removal', async () => {
		await fileRemovalAppeal({ removalId: 'r1', body: 'first' });
		await expect(fileRemovalAppeal({ removalId: 'r1', body: 'second' })).rejects.toBeInstanceOf(
			AppealAlreadyFiledError
		);
	});

	it('refuses a removal that does not exist', async () => {
		await expect(fileRemovalAppeal({ removalId: 'nope', body: 'x' })).rejects.toBeInstanceOf(
			AppealNotFoundError
		);
	});
});

describe('getRemovalNotice', () => {
	it('moves from no appeal to pending, and never carries the reason', async () => {
		expect(await getRemovalNotice('r1')).toMatchObject({ kind: 'suspension', appeal: 'none' });
		await fileRemovalAppeal({ removalId: 'r1', body: 'x' });
		const notice = await getRemovalNotice('r1');
		expect(notice).toMatchObject({ appeal: 'pending', lifted: false });
		expect(JSON.stringify(notice)).not.toContain('Threats');
	});
});
