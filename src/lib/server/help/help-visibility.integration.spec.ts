/**
 * Who can read a help article, against real SQLite on the real migrated tables.
 *
 * An article's capabilities admit a reader below its tier (#1638: a committee
 * granted `sponsor.read` reads at `member`) and, on a staff article, narrow it to
 * their holders (#3005). One naming none is for every position holder.
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
vi.mock('#lib/server/db/index.js', () => ({
	get db() {
		return dbRef.current;
	}
}));
vi.mock('$app/server', () => ({
	getRequestEvent: () => {
		throw new Error('help visibility must resolve without a request event');
	}
}));
vi.mock('#lib/server/finance/subscription-service.js', () => ({
	isSustainingMember: async () => false
}));

const {
	resolveHelpReader,
	getArticleBySlug,
	listNonEmptyCategories,
	listArticlesByCategory,
	listReadableArticles
} = await import('./help-service');
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
			('u-staff',     'Sal Staff',  'sal@example.com',  1),
			('u-treasurer', 'Tia Books',  'tia@example.com',  1),
			('u-admin',     'Ada Admin',  'ada@example.com',  1);

		INSERT OR IGNORE INTO roles (name, guard_name) VALUES
			('staff', 'web'), ('treasurer', 'web'), ('admin', 'web');
		INSERT INTO model_has_roles (role_id, user_id)
			SELECT id, 'u-staff' FROM roles WHERE name = 'staff';
		INSERT INTO model_has_roles (role_id, user_id)
			SELECT id, 'u-treasurer' FROM roles WHERE name = 'treasurer';
		INSERT INTO model_has_roles (role_id, user_id)
			SELECT id, 'u-admin' FROM roles WHERE name = 'admin';

		INSERT INTO "group" (id, kind, name, slug) VALUES ('g-dev', 'committee', 'Development', 'development');
		INSERT INTO group_member (id, group_id, user_id, role, status) VALUES
			('gm-1', 'g-dev', 'u-committee', 'member', 'active');
		INSERT INTO group_capability (group_id, capability) VALUES ('g-dev', 'sponsor.read');

		INSERT INTO help_categories (id, name, slug, min_role) VALUES
			('c-staff', 'Staff Guide', 'staff-guide', 'staff'),
			('c-member', 'Getting Started', 'getting-started', 'member');

		INSERT INTO help_articles (id, category_id, title, slug, content, min_role, published, capabilities) VALUES
			('a-sponsors', 'c-staff', 'Track Sponsors and Grants', 'staff-sponsors-grants', 'sponsor body', 'staff', 1, '["sponsor.read","grant.read"]'),
			('a-incidents', 'c-staff', 'Read Incidents', 'staff-incidents', 'incident body', 'staff', 1, '["incident.read"]'),
			('a-bookings', 'c-staff', 'Manage Bookings', 'staff-bookings', 'sponsor mention', 'staff', 1, NULL),
			('a-purge', 'c-staff', 'Purge an Account', 'staff-purge', 'purge body', 'staff', 1, '["user.purge"]'),
			('a-welcome', 'c-member', 'Welcome', 'welcome', 'hello', 'member', 1, NULL),
			('a-draft', 'c-member', 'Door Policy', 'door-policy', 'draft', 'member', 0, NULL);
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
		expect(await getArticleBySlug('staff-incidents', reader)).toBeNull();
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

	it('lets staff read every staff article but the admin-only one', async () => {
		const reader = await resolveHelpReader('u-staff');
		expect(reader.audience).toBe('staff');
		const articles = await listArticlesByCategory('c-staff', reader);
		expect(articles.map((a) => a.slug).sort()).toEqual([
			'staff-bookings',
			'staff-incidents',
			'staff-sponsors-grants'
		]);
	});
});

describe('a position holder, against the capabilities a staff article names (#3005)', () => {
	it('reads articles naming a capability they hold, and those naming none', async () => {
		const reader = await resolveHelpReader('u-treasurer');
		expect(reader.audience).toBe('staff');
		const articles = await listArticlesByCategory('c-staff', reader);
		expect(articles.map((a) => a.slug).sort()).toEqual(['staff-bookings', 'staff-sponsors-grants']);
		expect(await getArticleBySlug('staff-incidents', reader)).toBeNull();
	});

	it('cannot find a hidden article in search, by its title or its body', async () => {
		const reader = await resolveHelpReader('u-treasurer');
		expect(await searchArticles('Incidents', reader)).toEqual([]);
		expect(await searchArticles('purge', reader)).toEqual([]);
	});

	it('leaves a hidden article out of links another record makes', async () => {
		const reader = await resolveHelpReader('u-treasurer');
		const ids = (await listReadableArticles(['a-incidents', 'a-bookings'], reader)).map(
			(a) => a.id
		);
		expect(ids).toEqual(['a-bookings']);
	});

	it('lets admin read every staff article', async () => {
		const reader = await resolveHelpReader('u-admin');
		const articles = await listArticlesByCategory('c-staff', reader);
		expect(articles.map((a) => a.slug).sort()).toEqual([
			'staff-bookings',
			'staff-incidents',
			'staff-purge',
			'staff-sponsors-grants'
		]);
	});
});

describe('listReadableArticles, for an article another record links to (#2728)', () => {
	const linked = ['a-welcome', 'a-draft', 'a-bookings', 'a-sponsors', 'a-missing'];

	it('leaves out drafts, missing ids and articles above the reader', async () => {
		const reader = await resolveHelpReader('u-member');
		expect((await listReadableArticles(linked, reader)).map((a) => a.id)).toEqual(['a-welcome']);
	});

	it('admits by capability the way the article page does', async () => {
		const reader = await resolveHelpReader('u-committee');
		const ids = (await listReadableArticles(linked, reader)).map((a) => a.id).sort();
		expect(ids).toEqual(['a-sponsors', 'a-welcome']);
	});

	it('returns nothing for no ids', async () => {
		expect(await listReadableArticles([], await resolveHelpReader('u-staff'))).toEqual([]);
	});
});

describe('the shipped frontmatter', () => {
	it.each([['staff-guide/staff-sponsors-grants.md', 'sponsor.read, grant.read']])(
		'%s names the capabilities that gate its page',
		(file, caps) => {
			const raw = readFileSync(join(CONTENT_DIR, file), 'utf-8');
			expect(raw).toMatch(new RegExp(`^capabilities: ${caps.replaceAll('.', '\\.')}$`, 'm'));
		}
	);
});
