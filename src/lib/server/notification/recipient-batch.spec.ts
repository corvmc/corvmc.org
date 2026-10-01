import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * `listBatchRecipients` against a real SQLite: whether a stored preference
 * overrides the type's default, and whether a removed account drops out, are
 * both a LEFT JOIN and a WHERE that a mocked `db` would agree with either way.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({ db: testDb }));

const { listBatchRecipients } = await import('./recipient');

beforeEach(() => {
	sqlite.exec(`delete from notification_preference; delete from user;`);
	sqlite.exec(`
		insert into user (id, name, email, email_verified, deleted_at) values
			('u-default', 'Dee', 'dee@example.com', 0, null),
			('u-no-email', 'Ned', 'ned@example.com', 0, null),
			('u-other-type', 'Ott', 'ott@example.com', 0, null),
			('u-gone', 'Gil', 'gil@example.com', 0, 1700000000);
		insert into notification_preference
			(id, user_id, notification_type, email_enabled, in_app_enabled, sms_enabled) values
			('p1', 'u-no-email', 'group_member_added', 0, 1, 0),
			('p2', 'u-other-type', 'announcement', 0, 0, 0);
	`);
});

describe('listBatchRecipients', () => {
	it('applies each member’s stored preference for this type, else its defaults', async () => {
		const rows = await listBatchRecipients(
			['u-default', 'u-no-email', 'u-other-type'],
			'group_member_added'
		);
		expect(rows.sort((a, b) => a.userId.localeCompare(b.userId))).toEqual([
			{
				userId: 'u-default',
				name: 'Dee',
				email: 'dee@example.com',
				emailEnabled: true,
				inAppEnabled: true
			},
			{
				userId: 'u-no-email',
				name: 'Ned',
				email: 'ned@example.com',
				emailEnabled: false,
				inAppEnabled: true
			},
			{
				userId: 'u-other-type',
				name: 'Ott',
				email: 'ott@example.com',
				emailEnabled: true,
				inAppEnabled: true
			}
		]);
	});

	it('leaves out a removed account', async () => {
		const rows = await listBatchRecipients(['u-gone', 'u-default'], 'group_member_added');
		expect(rows.map((r) => r.userId)).toEqual(['u-default']);
	});

	it('asks nothing for nobody', async () => {
		expect(await listBatchRecipients([], 'group_member_added')).toEqual([]);
	});
});
