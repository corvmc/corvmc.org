import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Which link counts as live is a predicate, so it runs against a real SQLite. */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('#lib/server/testing/migrated-sqlite.js');
	return migratedSqlite();
});

vi.mock('#lib/server/db/index.js', () => ({ db: testDb }));
vi.mock('#lib/server/authorization.js', () => ({ requireCapability: async () => ({ id: 's1' }) }));

const { liveContactSheetLink } = await import('./contact-sheet-service');

const DAY = 86_400;
const now = () => Math.floor(Date.now() / 1000);

function link(id: string, over: { expires?: number; revoked?: number; created?: number } = {}) {
	sqlite
		.prepare(
			`insert into directory_entry_link (id, entry_id, token, email, expires_at, revoked_at, created_at)
			 values (?, 'de-1', ?, ?, ?, ?, ?)`
		)
		.run(
			id,
			`tok-${id}`,
			`${id}@act.test`,
			over.expires ?? now() + 10 * DAY,
			over.revoked ?? null,
			over.created ?? now()
		);
}

function outbox(id: string, linkId: string, status: string) {
	sqlite
		.prepare(
			`insert into outbox_message (id, kind, payload, subject_type, subject_id, status)
			 values (?, 'email', '{}', 'directory_entry_link', ?, ?)`
		)
		.run(id, linkId, status);
}

beforeEach(() => {
	sqlite.exec('delete from outbox_message');
	sqlite.exec('delete from directory_entry_link');
	sqlite.exec('delete from directory_entry');
	sqlite.exec(`insert into directory_entry (id, name) values ('de-1', 'Touring Act')`);
});

describe('the live contact-sheet link', () => {
	it('is the newest link that is neither revoked nor expired', async () => {
		link('old', { revoked: now() - DAY, created: now() - 2 * DAY });
		link('lapsed', { expires: now() - 1, created: now() - DAY });
		link('live', { created: now() - 3 * DAY });

		expect(await liveContactSheetLink('de-1')).toMatchObject({ email: 'live@act.test' });
	});

	it('is null when every link is revoked or expired', async () => {
		link('old', { revoked: now() - DAY });
		link('lapsed', { expires: now() - 1 });

		expect(await liveContactSheetLink('de-1')).toBeNull();
	});

	it('says whether its own email went, not an older link’s', async () => {
		link('old', { revoked: now() - DAY, created: now() - DAY });
		outbox('m-old', 'old', 'sent');
		link('live');
		outbox('m-live', 'live', 'failed');

		expect(await liveContactSheetLink('de-1')).toMatchObject({ emailed: false });

		sqlite.exec(`update outbox_message set status = 'sent' where id = 'm-live'`);
		expect(await liveContactSheetLink('de-1')).toMatchObject({ emailed: true });
	});
});
