/**
 * The directory listing against real SQLite: who is listed, and in what order.
 *
 * The completeness gate and both orders are `RAW` SQL with correlated
 * subqueries, so a mocked `db` would agree with them whether or not they ran.
 * See `directory-match.integration.spec.ts` for the same setup.
 */
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';
import * as schema from '$lib/server/db/schema';
import { relations } from '$lib/server/db/schema/relations';

const MIGRATIONS_FOLDER = join(import.meta.dirname, '..', '..', '..', '..', 'migrations');

let sqlite: DatabaseSync;

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }));
vi.mock('$lib/server/db', () => ({
	get db() {
		return dbRef.current;
	}
}));
vi.mock('$lib/server/storage', () => ({ resolveImageUrl: (k: string | null) => k }));

const {
	listMembers,
	listPublicMembers,
	listBands,
	listPublicBands,
	searchDirectoryMembers,
	getMemberProfile,
	isProfileComplete
} = await import('./directory-service');

beforeAll(() => {
	sqlite = new DatabaseSync(':memory:');
	migrate(drizzle({ client: sqlite }), { migrationsFolder: MIGRATIONS_FOLDER });
	dbRef.current = drizzle({ client: sqlite, schema, relations });

	// Join dates run oldest (u-bio) to newest (u-blank). Names are chosen so
	// A–Z and newest-first disagree everywhere.
	sqlite.exec(`
		INSERT INTO user (id, name, email, email_verified, image, created_at) VALUES
			('u-bio',     'Ada Bio',      'ada@example.com',    1, NULL,               1000),
			('u-photo',   'Zed Photo',    'zed@example.com',    1, 'avatars/zed.png',  2000),
			('u-tagged',  'Mo Tagged',    'mo@example.com',     1, NULL,               3000),
			('u-spaces',  'Cy Spaces',    'cy@example.com',     1, '  ',               4000),
			('u-public',  'Bo Public',    'bo@example.com',     1, NULL,               5000),
			('u-pblank',  'Al PubBlank',  'al@example.com',     1, NULL,               6000),
			('u-blank',   'Chris Blank',  'chris@example.com',  1, NULL,               7000);

		INSERT INTO directory_entry (id, user_id, name, tagline, bio, visibility) VALUES
			('e-bio',    'u-bio',    'Ada Bio',     NULL,    '<p>Hi</p>', 'members'),
			('e-photo',  'u-photo',  'Zed Photo',   NULL,    NULL,        'members'),
			('e-tagged', 'u-tagged', 'Mo Tagged',   NULL,    NULL,        'members'),
			('e-spaces', 'u-spaces', 'Cy Spaces',   '   ',   char(10, 9), 'members'),
			('e-public', 'u-public', 'Bo Public',   'Drums', NULL,        'public'),
			('e-pblank', 'u-pblank', 'Al PubBlank', NULL,    NULL,        'public'),
			('e-blank',  'u-blank',  'Chris Blank', NULL,    NULL,        'members');

		INSERT INTO directory_tag (entry_id, kind, value) VALUES
			('e-tagged', 'instrument', 'bass');

		INSERT INTO "group" (id, kind, name, slug, created_at) VALUES
			('g-old', 'band', 'Alpha Old', 'alpha-old', 1000),
			('g-new', 'band', 'Zebra New', 'zebra-new', 2000);

		INSERT INTO directory_entry (id, group_id, name, visibility) VALUES
			('e-g-old', 'g-old', 'Alpha Old', 'public'),
			('e-g-new', 'g-new', 'Zebra New', 'public');
	`);
}, 30_000);

afterAll(() => sqlite?.close());

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe('the member directory lists only complete profiles', () => {
	it('leaves out a blank entry and keeps one with a single instrument', async () => {
		const listed = ids(await listMembers());
		expect(listed).not.toContain('u-blank');
		expect(listed).toContain('u-tagged');
	});

	it('counts a bio or a photo, and not whitespace', async () => {
		const listed = ids(await listMembers());
		expect(listed).toEqual(expect.arrayContaining(['u-bio', 'u-photo']));
		expect(listed).not.toContain('u-spaces');
	});

	it('applies the same gate to the public directory', async () => {
		const listed = ids(await listPublicMembers());
		expect(listed).toEqual(['u-public']);
	});

	it('leaves the message composer search finding a blank profile', async () => {
		const found = (await searchDirectoryMembers('Chris', 'u-bio')).map((r) => r.id);
		expect(found).toEqual(['u-blank']);
	});
	it('still opens a blank profile from a direct link', async () => {
		await expect(getMemberProfile('u-blank', 'members')).resolves.toMatchObject({
			id: 'u-blank'
		});
	});

	it('agrees with isProfileComplete for every member', async () => {
		const listed = new Set([...ids(await listMembers()), ...ids(await listPublicMembers())]);
		for (const id of [
			'u-bio',
			'u-photo',
			'u-tagged',
			'u-spaces',
			'u-public',
			'u-pblank',
			'u-blank'
		]) {
			expect(await isProfileComplete(id), id).toBe(listed.has(id));
		}
	});
});

describe('directory order', () => {
	it('lists members newest first by default, and A–Z on request', async () => {
		expect(ids(await listMembers())).toEqual(['u-public', 'u-tagged', 'u-photo', 'u-bio']);
		expect(ids(await listMembers({ sort: 'name' }))).toEqual([
			'u-bio',
			'u-public',
			'u-tagged',
			'u-photo'
		]);
	});

	it('lists bands newest first by default, and A–Z on request', async () => {
		expect(ids(await listBands())).toEqual(['g-new', 'g-old']);
		expect(ids(await listPublicBands())).toEqual(['g-new', 'g-old']);
		expect(ids(await listBands({ sort: 'name' }))).toEqual(['g-old', 'g-new']);
	});
});
