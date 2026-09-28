/**
 * Who can read a help article, against real SQLite on the real migrated tables.
 *
 * An article may name capabilities that admit a reader in addition to its tier
 * (#1638): a committee granted `sponsor.read` holds no position, so reads at
 * `member`, but must still reach the staff article for the page it can open.
 * The capability clause is a correlated `json_each`, which only the engine can judge.
 */
import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';

const MIGRATIONS_FOLDER = join(import.meta.dirname, '..', '..', '..', '..', 'migrations');
const CONTENT_DIR = join(import.meta.dirname, '..', '..', '..', 'content', 'help');

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }));
vi.mock('$lib/server/db', () => ({
	get db() {
		return dbRef.current;
	}
}));
vi.mock('$app/server', () => ({
	getRequestEvent: () => {
		throw new Error('help visibility must resolve without a request event');
	}
}));
vi.mock('$lib/server/finance/subscription-service', () => ({
	isSustainingMember: async () => false
}));

const { resolveHelpReader, getArticleBySlug, listNonEmptyCategories, listArticlesByCategory } =
	await import('./help-service');
const searchArticles = (await import('./help-service')).searchArticles;

let sqlite: DatabaseSync;

beforeAll(() => {
	sqlite = new DatabaseSync(':memory:');
	migrate(drizzle({ client: sqlite }), { migrationsFolder: MIGRATIONS_FOLDER });
	dbRef.current = drizzle({ client: sqlite });

	sqlite.exec(`
		INSERT INTO user (id, name, email, email_verified) VALUES
			('u-committee', 'Cora Dev',   'cora@example.com', 1),
			('u-member',    'Max Plain',  'max@example.com',  1),
			('u-staff',     'Sal Staff',  'sal@example.com',  1);

		INSERT OR IGNORE INTO roles (name, guard_name) VALUES ('staff', 'web');
		INSERT INTO model_has_roles (role_id, user_id)
			SELECT id, 'u-staff' FROM roles WHERE name = 'staff';

		INSERT INTO "group" (id, kind, name, slug) VALUES ('g-dev', 'committee', 'Development', 'development');
		INSERT INTO group_member (id, group_id, user_id, role, status) VALUES
			('gm-1', 'g-dev', 'u-committee', 'member', 'active');
		INSERT INTO group_capability (group_id, capability) VALUES ('g-dev', 'sponsor.read');

		INSERT INTO help_categories (id, name, slug, min_role) VALUES
			('c-staff', 'Staff Guide', 'staff-guide', 'staff'),
			('c-member', 'Getting Started', 'getting-started', 'member');

		INSERT INTO help_articles (id, category_id, title, slug, content, min_role, published, capabilities) VALUES
			('a-sponsors', 'c-staff', 'Track Sponsors and Grants', 'staff-sponsors-grants', 'sponsor body', 'staff', 1, '["sponsor.read","grant.read"]'),
			('a-renewals', 'c-staff', 'Track Renewals', 'staff-renewals', 'renewal body', 'staff', 1, '["renewal.read"]'),
			('a-bookings', 'c-staff', 'Manage Bookings', 'staff-bookings', 'sponsor mention', 'staff', 1, NULL),
			('a-welcome', 'c-member', 'Welcome', 'welcome', 'hello', 'member', 1, NULL);
	`);
}, 30_000);

afterAll(() => sqlite?.close());

describe('a committee member granted sponsor.read, holding no position', () => {
	it('reads the sponsors and grants staff article', async () => {
		const reader = await resolveHelpReader('u-committee');
		expect(reader.audience).toBe('member');
		expect((await getArticleBySlug('staff-sponsors-grants', reader))?.id).toBe('a-sponsors');
	});

	it('does not read a staff article that names no capability, or one naming another', async () => {
		const reader = await resolveHelpReader('u-committee');
		expect(await getArticleBySlug('staff-bookings', reader)).toBeNull();
		expect(await getArticleBySlug('staff-renewals', reader)).toBeNull();
	});

	it('sees the staff category listing only the article it is admitted to', async () => {
		const reader = await resolveHelpReader('u-committee');
		const categories = await listNonEmptyCategories(reader);
		expect(categories.map((c) => c.slug).sort()).toEqual(['getting-started', 'staff-guide']);
		const articles = await listArticlesByCategory('c-staff', reader);
		expect(articles.map((a) => a.slug)).toEqual(['staff-sponsors-grants']);
	});

	it('finds the admitted article in search, and not its neighbours', async () => {
		const reader = await resolveHelpReader('u-committee');
		const results = await searchArticles('sponsor', reader);
		expect(results.map((r) => r.slug)).toEqual(['staff-sponsors-grants']);
	});
});

describe('readers the capability clause must not change', () => {
	it('keeps a plain member out of every staff article', async () => {
		const reader = await resolveHelpReader('u-member');
		expect(await getArticleBySlug('staff-sponsors-grants', reader)).toBeNull();
		expect((await listNonEmptyCategories(reader)).map((c) => c.slug)).toEqual(['getting-started']);
	});

	it('lets staff read every staff article, capability or not', async () => {
		const reader = await resolveHelpReader('u-staff');
		expect(reader.audience).toBe('staff');
		const articles = await listArticlesByCategory('c-staff', reader);
		expect(articles.map((a) => a.slug).sort()).toEqual([
			'staff-bookings',
			'staff-renewals',
			'staff-sponsors-grants'
		]);
	});
});

describe('the shipped frontmatter', () => {
	it.each([
		['staff-guide/staff-sponsors-grants.md', 'sponsor.read, grant.read'],
		['staff-guide/staff-renewals.md', 'renewal.read']
	])('%s names the capabilities that gate its page', (file, caps) => {
		const raw = readFileSync(join(CONTENT_DIR, file), 'utf-8');
		expect(raw).toMatch(new RegExp(`^capabilities: ${caps.replaceAll('.', '\\.')}$`, 'm'));
	});
});
