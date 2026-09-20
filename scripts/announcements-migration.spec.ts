import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The migration that turns announcements into threads (#1307).
 *
 * `migrate-local.spec.ts` replays every migration, so the SQL is known to
 * *run*. What that cannot check is whether the copy preserves what is only
 * wrong later: a back catalogue sorted to the bottom, a deleted author's
 * blank byline, a draft that has gone out. Asserted as text, no database.
 */
const sql = readFileSync(
	join(process.cwd(), 'migrations/20260920045700_announcements_become_threads/migration.sql'),
	'utf8'
);

describe('announcements become threads', () => {
	it('sets the policies that make a thread an announcement', () => {
		expect(sql).toContain("'leadership'");
		expect(sql).toContain("'email'");
	});

	// Without this the whole back catalogue sorts below every chat topic,
	// because `last_message_at` is what orders the list. A draft has no
	// published_at and falls back to when it was written.
	it('gives every migrated row a sort key', () => {
		expect(sql).toMatch(/last_message_at[\s\S]*COALESCE\(a\.published_at, a\.created_at\)/);
	});

	// `announcement.author_id` is SET NULL on purpose — the post outlives the
	// account — and the timeline renders `author_name`, not the join.
	it('leaves a byline behind for a deleted author', () => {
		expect(sql).toContain("COALESCE(u.name, 'A former member')");
		expect(sql).toContain('LEFT JOIN user u');
	});

	// A draft must not arrive published, or migrating mails the roster.
	it('carries publication state rather than assuming it', () => {
		expect(sql).toContain('a.published_at');
		expect(sql).not.toMatch(/published_at[^,\n]*unixepoch/);
	});

	it('carries the fan-out latch, so a migrated post is not re-sent', () => {
		expect(sql).toContain('a.notified_at');
		expect(sql).toContain('a.recipient_count');
	});

	// Reusing the announcement's id makes a double-run a primary-key violation
	// rather than a silent duplicate, and lets #1309 match the tables up.
	it('reuses the announcement id for both rows', () => {
		expect(sql).toMatch(/INSERT INTO inbox_thread[\s\S]*?SELECT\s*\n\s*a\.id,/);
		expect(sql).toMatch(/INSERT INTO inbox_message[\s\S]*?a\.id,\s*\n\s*a\.id,/);
	});

	// Prod D1 is canonical. Nothing is dropped until #1309 has checked the read
	// surfaces against real rows.
	it('drops nothing', () => {
		expect(sql).not.toMatch(/\bDROP\b/i);
		expect(sql).not.toMatch(/\bDELETE\b/i);
	});
});
