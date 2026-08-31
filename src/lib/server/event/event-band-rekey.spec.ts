import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';

/**
 * The phase-10 re-key, against the real migrated schema.
 *
 * `event_band.bandId` → `directoryEntryId` is one of the two re-keys in this
 * spec that is **not** value-preserving: `band_id` holds a `group.id` and the
 * entry has its own, so the migration resolves through a lookup rather than
 * carrying the value across. A lookup can miss, and a credit left with a NULL
 * entry would be a confirmed act that silently renders as plain text — visible
 * to nobody until someone notices a link is gone.
 *
 * So this migrates the committed set into an in-memory database, puts a band, an
 * entry and a credit through it, and asserts on what the UPDATE actually did.
 * The unit specs above mock the db and cannot see any of it.
 */

const MIGRATIONS_FOLDER = join(import.meta.dirname, '..', '..', '..', '..', 'migrations');

let db: DatabaseSync;

beforeAll(() => {
	db = new DatabaseSync(':memory:');
	migrate(drizzle({ client: db }), { migrationsFolder: MIGRATIONS_FOLDER });
});

afterAll(() => db?.close());

describe('the migrated event_band', () => {
	it('has replaced band_id outright', () => {
		const cols = (db.prepare(`PRAGMA table_info('event_band')`).all() as { name: string }[]).map(
			(c) => c.name
		);
		expect(cols).toContain('directory_entry_id');
		// Gone as of 10b. It was kept through 10a so the backfill stayed
		// recoverable from a column still being maintained.
		expect(cols).not.toContain('band_id');
		// Renamed rather than recreated: `added_by_band_id` named a group all
		// along, and the values had to survive.
		expect(cols).toContain('added_by_group_id');
		expect(cols).not.toContain('added_by_band_id');
	});

	/**
	 * drizzle-kit records these against the new column in its snapshot but emits
	 * no statements for them. Without the hand-written DROP/CREATE the database
	 * keeps both indexes keyed to `band_id` while the snapshot claims otherwise —
	 * and the unique one is what stops a party appearing twice on one bill.
	 */
	it('keys both indexes to the new column, not the old one', () => {
		const sql = (
			db
				.prepare(`select sql from sqlite_master where type='index' and tbl_name='event_band'`)
				.all() as { sql: string | null }[]
		)
			.map((r) => r.sql ?? '')
			.join('\n');

		expect(sql).toContain('uq_event_band_event_band');
		expect(sql).toMatch(/uq_event_band_event_band[^\n]*directory_entry_id/);
		expect(sql).toMatch(/idx_event_band_band_status[^\n]*directory_entry_id/);
		// The old keying is gone rather than merely joined by a new index.
		expect(sql).not.toMatch(/uq_event_band_event_band[^\n]*`band_id`/);
	});

	it('still refuses the same party twice on one bill', () => {
		db.exec(`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
		         VALUES ('u1', 'Ada', 'ada@test', 0, 0, 0)`);
		db.exec(`INSERT INTO "group" (id, name, slug) VALUES ('g1', 'The Squares', 'the-squares')`);
		db.exec(`INSERT INTO directory_entry (id, group_id, name) VALUES ('de1', 'g1', 'The Squares')`);
		// `ends_at` because `event_cmc_needs_end` requires one of a CMC event, and
		// `source` defaults to 'cmc'.
		db.exec(`INSERT INTO event (id, title, starts_at, ends_at, created_by_user_id)
		         VALUES ('e1', 'Show', 0, 100, 'u1')`);
		db.exec(`INSERT INTO event_band (id, event_id, name, directory_entry_id, status)
		         VALUES ('eb1', 'e1', 'The Squares', 'de1', 'confirmed')`);

		expect(() =>
			db.exec(`INSERT INTO event_band (id, event_id, name, directory_entry_id, status)
			         VALUES ('eb2', 'e1', 'The Squares again', 'de1', 'confirmed')`)
		).toThrow(/UNIQUE/i);
	});

	/**
	 * The partial index has to permit many name-only credits per event, which is
	 * the common case and the whole of backfilled history.
	 */
	it('permits any number of unlinked credits on one bill', () => {
		db.exec(`INSERT INTO event_band (id, event_id, name, status)
		         VALUES ('eb3', 'e1', 'Paper Wolves', 'unlinked')`);
		expect(() =>
			db.exec(`INSERT INTO event_band (id, event_id, name, status)
			         VALUES ('eb4', 'e1', 'Bright Sirens', 'unlinked')`)
		).not.toThrow();
	});

	/**
	 * An external act is an entry with no user and no group. The credit points at
	 * it exactly as it would at a band's, and the group being null is the same
	 * fact as "there is no CMC page to link to".
	 */
	it('accepts a credit pointing at an entry with no owner', () => {
		db.exec(`INSERT INTO directory_entry (id, name, visibility)
		         VALUES ('de-ext', 'Touring Act', 'hidden')`);
		expect(() =>
			db.exec(`INSERT INTO event_band (id, event_id, name, directory_entry_id, status)
			         VALUES ('eb5', 'e1', 'Touring Act', 'de-ext', 'confirmed')`)
		).not.toThrow();

		const row = db
			.prepare(
				`select de.user_id, de.group_id from event_band eb
				 join directory_entry de on de.id = eb.directory_entry_id where eb.id = 'eb5'`
			)
			.get() as { user_id: string | null; group_id: string | null };
		expect(row.user_id).toBeNull();
		expect(row.group_id).toBeNull();
	});

	it('resolves a credit back to its CMC band through the entry', () => {
		const row = db
			.prepare(
				`select de.group_id from event_band eb
				 join directory_entry de on de.id = eb.directory_entry_id where eb.id = 'eb1'`
			)
			.get() as { group_id: string | null };
		expect(row.group_id).toBe('g1');
	});
});
