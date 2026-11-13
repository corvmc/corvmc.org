import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Two appeals filed at once, against a real SQLite behind the D1 driver. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/event-bus/event-bus.js', () => ({ domainEvents: { emit: vi.fn() } }));
vi.mock('#lib/server/sentry.js', () => ({ captureException: vi.fn() }));

const { fileAppeal, AppealAlreadyFiledError } = await import('./appeal-service');

beforeEach(() => {
	sqlite.exec('drop trigger if exists other_tab_appeals');
	for (const table of ['moderation_appeal', 'content_flag', 'suggestion'])
		sqlite.exec(`delete from ${table}`);
	sqlite.exec(
		`insert into suggestion (id, title, body, author_user_id) values ('s-1', 'T', 'B', 'user-1')`
	);
	sqlite.exec(
		`insert into content_flag (id, entity_type, entity_id, reported_by_user_id, reason, status, resolved_at)
		 values ('flag-1', 'suggestion', 's-1', 'user-2', 'spam', 'resolved', unixepoch())`
	);
});

describe('fileAppeal', () => {
	it('reports the appeal already filed when another lands first', async () => {
		// The other tab's appeal lands between this one's check and its write.
		sqlite.exec(
			`create trigger other_tab_appeals before insert on moderation_appeal
			 when new.id <> 'other-tab'
			 begin
				insert into moderation_appeal (id, flag_id, appellant_user_id, body)
				values ('other-tab', 'flag-1', 'user-1', 'first');
			 end`
		);
		await expect(
			fileAppeal({
				userId: 'user-1',
				userName: 'Member',
				target: { kind: 'suggestion', suggestionId: 's-1' },
				body: 'second'
			})
		).rejects.toBeInstanceOf(AppealAlreadyFiledError);
	});
});
