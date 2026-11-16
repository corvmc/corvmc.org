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
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-sqlite';
import { migrate } from 'drizzle-orm/node-sqlite/migrator';

import { seatSql } from '#lib/server/testing/operations-seat.js';
import { surfaces } from '#lib/config.js';
import { helpSlugOf, renderMarkdown, unlinkHelpArticles } from '#lib/utils/markdown.js';

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
	listReadableArticles,
	createArticle,
	updateArticle
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

		INSERT OR IGNORE INTO roles (name, guard_name) VALUES ('admin', 'web');
		INSERT INTO model_has_roles (role_id, user_id)
			SELECT id, 'u-admin' FROM roles WHERE name = 'admin';
		${seatSql('u-staff', 'staff')}
		${seatSql('u-treasurer', 'treasurer')}

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

		INSERT INTO help_categories (id, name, slug, min_role) VALUES
			('c-votes', 'Votes', 'votes', 'member');
		INSERT INTO help_articles (id, category_id, title, slug, content, min_role, published, surface) VALUES
			('a-ballots', 'c-votes', 'Ballots', 'ballots', 'ballot body', 'member', 1, 'ballots'),
			('a-board', 'c-member', 'Suggestion Board', 'suggestion-board',
				'Put it to a [ballot](/member/help/ballots). Say [hello](/member/help/welcome).', 'member', 1, NULL);
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

describe('an article written in the staff editor (#3011)', () => {
	async function editorArticle(slug: string, capabilities?: string[]) {
		return createArticle({
			categoryId: 'c-staff',
			title: `Editor ${slug}`,
			slug,
			content: 'ledger body',
			minRole: 'staff',
			published: true,
			capabilities
		});
	}

	it('hides one naming a capability from a position holder without it, in search and links', async () => {
		const article = await editorArticle('editor-incidents', ['incident.read']);
		expect(article.source).toBe('dynamic');
		const treasurer = await resolveHelpReader('u-treasurer');
		expect(await searchArticles('ledger', treasurer)).toEqual([]);
		expect(await listReadableArticles([article.id], treasurer)).toEqual([]);
		const staff = await resolveHelpReader('u-staff');
		expect((await searchArticles('ledger', staff)).map((r) => r.id)).toEqual([article.id]);
	});

	it('keeps capabilities a save leaves out, and clears them on an empty list', async () => {
		const article = await editorArticle('editor-kept', ['incident.read']);
		const treasurer = await resolveHelpReader('u-treasurer');
		await updateArticle(article.id, { title: 'Editor kept, renamed' });
		expect(await listReadableArticles([article.id], treasurer)).toEqual([]);
		const cleared = await updateArticle(article.id, { capabilities: [] });
		expect(cleared.capabilities).toBeNull();
		expect((await listReadableArticles([article.id], treasurer)).map((a) => a.id)).toEqual([
			article.id
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

describe('an article naming a switched-off surface', () => {
	it.each(['u-member', 'u-admin'])('is hidden from %s on every read path', async (user) => {
		expect(surfaces.ballots).toBe(false);
		const reader = await resolveHelpReader(user);
		expect(await getArticleBySlug('ballots', reader)).toBeNull();
		expect((await searchArticles('ballot', reader)).map((r) => r.id)).not.toContain('a-ballots');
		expect(await listArticlesByCategory('c-votes', reader)).toEqual([]);
		expect(await listReadableArticles(['a-ballots'], reader)).toEqual([]);
		expect((await listNonEmptyCategories(reader)).map((c) => c.slug)).not.toContain('votes');
	});

	it('reads as any other article once the surface is on', async () => {
		surfaces.ballots = true;
		try {
			const reader = await resolveHelpReader('u-member');
			expect((await getArticleBySlug('ballots', reader))?.id).toBe('a-ballots');
			expect((await searchArticles('ballot', reader)).map((r) => r.id)).toContain('a-ballots');
			expect((await listNonEmptyCategories(reader)).map((c) => c.slug)).toContain('votes');
		} finally {
			surfaces.ballots = false;
		}
	});

	it('is not linked from an article that stays visible (#3123)', async () => {
		const reader = await resolveHelpReader('u-member');
		const read = async () => (await getArticleBySlug('suggestion-board', reader))?.content;
		expect(await read()).toBe('Put it to a ballot. Say [hello](/member/help/welcome).');
		surfaces.ballots = true;
		try {
			expect(await read()).toContain('[ballot](/member/help/ballots)');
		} finally {
			surfaces.ballots = false;
		}
	});
});

/** Every shipped help article: its slug, surface (if any) and markdown body. */
function shippedArticles() {
	return readdirSync(CONTENT_DIR, { recursive: true, encoding: 'utf-8' })
		.filter((f) => f.endsWith('.md'))
		.map((file) => {
			const raw = readFileSync(join(CONTENT_DIR, file), 'utf-8');
			const [, front = '', body = ''] = raw.split(/^---$/m);
			const field = (k: string) => front.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1].trim();
			return { file, slug: field('slug'), surface: field('surface'), body };
		});
}

describe('the shipped help tree', () => {
	// Every surface-tagged article counts as hidden, so the guard holds whichever switch is off.
	const articles = shippedArticles();
	const hidden = new Set(articles.filter((a) => a.surface).map((a) => a.slug!));

	it('has articles hidden by a surface to guard', () => {
		expect(hidden.size).toBeGreaterThan(0);
	});

	it.each(articles.map((a) => [a.file, a.body]))(
		'%s renders no link to a surface-hidden article',
		(_file, body) => {
			const html = renderMarkdown(unlinkHelpArticles(body, hidden));
			const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => helpSlugOf(m[1]));
			expect(hrefs.filter((slug) => slug && hidden.has(slug))).toEqual([]);
		}
	);
});

describe('the shipped frontmatter', () => {
	it.each([['staff-guide/staff-sponsors-grants.md', 'sponsor.read, grant.read']])(
		'%s names the capabilities that gate its page',
		(file, caps) => {
			const raw = readFileSync(join(CONTENT_DIR, file), 'utf-8');
			expect(raw).toMatch(new RegExp(`^capabilities: ${caps.replaceAll('.', '\\.')}$`, 'm'));
		}
	);

	it.each([
		['profile-directory/classifieds.md', 'classifieds'],
		['suggestions/ballots.md', 'ballots']
	])('%s names the switched-off surface it documents', (file, surface) => {
		const raw = readFileSync(join(CONTENT_DIR, file), 'utf-8');
		expect(raw).toMatch(new RegExp(`^surface: ${surface}$`, 'm'));
	});
});
