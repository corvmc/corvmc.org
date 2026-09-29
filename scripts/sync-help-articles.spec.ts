import { describe, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { migratedSqlite } from '../src/lib/server/testing/migrated-sqlite';
import { d1HttpClient, syncHelpArticles, type StaticArticle } from './sync-help-articles';

const creds = { accountId: 'acct', databaseId: 'db-id', token: 'tok' };

/** Answers the D1 HTTP API from a real SQLite, in the shapes `/query` and `/raw` return. */
function d1Over(sqlite: ReturnType<typeof migratedSqlite>['sqlite']) {
	return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		const { sql, params } = JSON.parse(String(init?.body)) as { sql: string; params: unknown[] };
		const stmt = sqlite.prepare(sql);
		if (String(url).endsWith('/raw')) {
			const rows = stmt.reader ? stmt.raw(true).all(...params) : (stmt.run(...params), []);
			return Response.json({ success: true, result: [{ results: { columns: [], rows } }] });
		}
		stmt.run(...params);
		return Response.json({ success: true, result: [{ results: [] }] });
	});
}

const article = (slug: string, over: Partial<StaticArticle['meta']> = {}): StaticArticle => ({
	meta: { title: `T ${slug}`, slug, category: 'getting-started', minRole: 'member', ...over },
	body: `Body of ${slug}`,
	capabilities: null
});

function setup() {
	const { sqlite } = migratedSqlite();
	const fetchImpl = d1Over(sqlite);
	const db = drizzle(d1HttpClient(creds, fetchImpl as unknown as typeof fetch));
	const rows = () =>
		sqlite
			.prepare('SELECT slug, title, published, min_role FROM help_articles ORDER BY slug')
			.all();
	return { sqlite, fetchImpl, db, rows };
}

describe('syncHelpArticles over the D1 HTTP client', () => {
	it('creates drafts, and a second run changes nothing but content', async () => {
		const { db, rows } = setup();
		await syncHelpArticles(db, [article('a'), article('b', { minRole: 'staff' })]);
		const first = rows();
		expect(first).toEqual([
			{ slug: 'a', title: 'T a', published: 0, min_role: 'member' },
			{ slug: 'b', title: 'T b', published: 0, min_role: 'staff' }
		]);

		await syncHelpArticles(db, [article('a'), article('b', { minRole: 'staff' })]);
		expect(rows()).toEqual(first);
	});

	it('updates in place without touching published, and deletes orphaned static rows', async () => {
		const { sqlite, db, rows } = setup();
		await syncHelpArticles(db, [article('a'), article('b')]);
		sqlite.prepare("UPDATE help_articles SET published = 1 WHERE slug = 'a'").run();

		await syncHelpArticles(db, [article('a', { title: 'Renamed' })]);
		expect(rows()).toEqual([{ slug: 'a', title: 'Renamed', published: 1, min_role: 'member' }]);
	});

	it('keeps a dynamic article whose slug is not in the tree', async () => {
		const { sqlite, db, rows } = setup();
		await syncHelpArticles(db, [article('a')]);
		const cat = sqlite.prepare('SELECT id FROM help_categories').get() as { id: string };
		sqlite
			.prepare(
				"INSERT INTO help_articles (id, category_id, title, slug, content, source) VALUES ('d', ?, 'Dyn', 'dyn', 'x', 'dynamic')"
			)
			.run(cat.id);

		await syncHelpArticles(db, [article('a')]);
		expect(rows().map((r) => (r as { slug: string }).slug)).toEqual(['a', 'dyn']);
	});

	it('derives the category audience from its most permissive article', async () => {
		const { sqlite, db } = setup();
		await syncHelpArticles(db, [
			article('s1', { category: 'staff-guide', minRole: 'staff' }),
			article('m1', { category: 'mixed', minRole: 'staff' }),
			article('m2', { category: 'mixed', minRole: 'member' })
		]);
		expect(
			sqlite.prepare('SELECT slug, min_role FROM help_categories ORDER BY slug').all()
		).toEqual([
			{ slug: 'mixed', min_role: 'member' },
			{ slug: 'staff-guide', min_role: 'staff' }
		]);
	});

	it('stores capabilities as JSON', async () => {
		const { sqlite, db } = setup();
		await syncHelpArticles(db, [{ ...article('c'), capabilities: ['user.list'] }]);
		expect(sqlite.prepare('SELECT capabilities FROM help_articles').get()).toEqual({
			capabilities: '["user.list"]'
		});
	});
});

describe('d1HttpClient', () => {
	it('posts to the account database with the bearer token, reads via /raw', async () => {
		const fetchImpl = vi.fn(async () =>
			Response.json({ success: true, result: [{ results: { columns: ['x'], rows: [[1], [2]] } }] })
		);
		const client = d1HttpClient(creds, fetchImpl as unknown as typeof fetch);

		expect(await client('SELECT x FROM t WHERE y = ?', ['z'], 'all')).toEqual({ rows: [[1], [2]] });
		expect(await client('SELECT x FROM t', [], 'get')).toEqual({ rows: [1] });

		const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acct/d1/database/db-id/raw');
		expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' });
		expect(JSON.parse(String(init.body))).toEqual({
			sql: 'SELECT x FROM t WHERE y = ?',
			params: ['z']
		});
	});

	it('sends writes to /query', async () => {
		const fetchImpl = vi.fn(async () =>
			Response.json({ success: true, result: [{ results: [] }] })
		);
		await d1HttpClient(creds, fetchImpl as unknown as typeof fetch)('DELETE FROM t', [], 'run');
		expect(String((fetchImpl.mock.calls[0] as unknown[])[0])).toMatch(/\/query$/);
	});

	it('throws with the API errors when the query fails', async () => {
		const fetchImpl = vi.fn(async () =>
			Response.json({ success: false, errors: [{ message: 'no such table' }] }, { status: 400 })
		);
		await expect(
			d1HttpClient(creds, fetchImpl as unknown as typeof fetch)('SELECT 1', [], 'all')
		).rejects.toThrow(/no such table/);
	});
});
