/**
 * Sync static help articles from src/content/help/ into the database.
 *
 * Usage:
 *   pnpm help:sync            local D1, through wrangler's platform proxy
 *   pnpm help:sync --remote   production D1, over the D1 HTTP API
 *
 * `--remote` needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_D1_TOKEN, the same pair
 * `ci:migrate` uses; `ci:migrate` runs it on every production deploy.
 */
import 'dotenv/config';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { pathToFileURL } from 'url';
import { drizzle } from 'drizzle-orm/d1';
import { drizzle as drizzleProxy, type AsyncRemoteCallback } from 'drizzle-orm/sqlite-proxy';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { eq, and, notInArray } from 'drizzle-orm';
import { databaseIdFromWrangler } from '../drizzle.config';
import { helpCategory, helpArticle } from '../src/lib/server/db/schema/help';
import { grantRuleFor, helpAudiences } from '../src/lib/config';

const CONTENT_DIR = join(import.meta.dirname, '../src/content/help');

interface ArticleFrontmatter {
	title: string;
	slug: string;
	category: string;
	summary?: string;
	minRole?: string;
	/** Comma-separated; any one admits a reader below `minRole`. */
	capabilities?: string;
	sortOrder?: number;
}

function parseFrontmatter(content: string): { meta: ArticleFrontmatter; body: string } {
	const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	if (!match) throw new Error('Missing frontmatter');

	const meta: Record<string, string | number> = {};
	for (const line of match[1].split('\n')) {
		const [key, ...rest] = line.split(':');
		if (key && rest.length) {
			const val = rest.join(':').trim();
			meta[key.trim()] = /^\d+$/.test(val) ? parseInt(val) : val;
		}
	}

	return { meta: meta as unknown as ArticleFrontmatter, body: match[2].trim() };
}

// The audience ladder is `helpAudiences` in src/lib/config.ts, lowest tier
// first — so a LOWER index is the more permissive audience. Imported rather
// than mirrored: the copy this replaced was a second closed table of role
// names, which is the shape that made a new position hide every article.
// Unknown frontmatter clamps to the most restrictive tier.
const audienceRank = (a: string) => {
	const i = (helpAudiences as readonly string[]).indexOf(a);
	return i === -1 ? helpAudiences.length : i;
};

/** Frontmatter is hand-written; clamp anything off the ladder to the most restrictive tier. */
const audienceOf = (a?: string) => {
	const v = a ?? 'member';
	return (helpAudiences as readonly string[]).includes(v) ? v : 'staff';
};

/**
 * A capability here admits a reader who holds it through a committee, so one no
 * committee can hold org-wide would admit nobody: a typo, and it fails the sync.
 */
function capabilitiesOf(file: string, raw?: string): string[] | null {
	const caps = (raw ?? '')
		.split(',')
		.map((c) => c.trim())
		.filter(Boolean);
	for (const c of caps) {
		if (grantRuleFor(c)?.committee !== 'org') {
			throw new Error(`${file}: capability "${c}" is not one a committee can hold org-wide`);
		}
	}
	return caps.length > 0 ? caps : null;
}

function findMarkdownFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			files.push(...findMarkdownFiles(full));
		} else if (entry.endsWith('.md')) {
			files.push(full);
		}
	}
	return files;
}

export interface StaticArticle {
	meta: ArticleFrontmatter;
	body: string;
	capabilities: string[] | null;
}

export function readArticles(dir = CONTENT_DIR): StaticArticle[] {
	const files = findMarkdownFiles(dir);
	console.log(`Found ${files.length} markdown file(s) in ${dir}`);
	return files.map((file) => {
		const { meta, body } = parseFrontmatter(readFileSync(file, 'utf-8'));
		return { meta, body, capabilities: capabilitiesOf(relative(dir, file), meta.capabilities) };
	});
}

export interface D1HttpCredentials {
	accountId: string;
	databaseId: string;
	token: string;
}

/**
 * A sqlite-proxy client over the D1 HTTP API, the transport drizzle-kit's
 * `d1-http` driver uses for `ci:migrate`. Reads go to `/raw`, because the
 * proxy maps selected fields from positional rows, not objects.
 */
export function d1HttpClient(
	creds: D1HttpCredentials,
	fetchImpl: typeof fetch = fetch
): AsyncRemoteCallback {
	const base = `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/d1/database/${creds.databaseId}`;
	return async (sql, params, method) => {
		const res = await fetchImpl(`${base}/${method === 'run' ? 'query' : 'raw'}`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ sql, params })
		});
		const body = (await res.json()) as {
			success: boolean;
			errors?: unknown;
			result?: { results?: { rows?: unknown[][] } }[];
		};
		if (!body.success) throw new Error(`D1 query failed: ${JSON.stringify(body.errors)}\n${sql}`);
		if (method === 'run') return { rows: [] };
		const rows = body.result?.[0]?.results?.rows ?? [];
		return { rows: method === 'get' ? (rows[0] ?? []) : rows };
	};
}

export type HelpSyncDb = BaseSQLiteDatabase<'async', unknown>;

export async function syncHelpArticles(db: HelpSyncDb, articles: StaticArticle[]) {
	const categorySlugs = new Set(articles.map((a) => a.meta.category));

	// A category is only as restricted as its most permissive article: a
	// staff-only category (every article minRole=staff) must not be listed to
	// members, but a mixed category should stay member-visible and simply hide
	// the staff articles inside it. Without this the category row falls back to
	// the schema default of 'member' and "Staff Guide" shows up on /member/help
	// as an empty card.
	const categoryMinRole = new Map<string, string>();
	for (const { meta } of articles) {
		const role = audienceOf(meta.minRole);
		const current = categoryMinRole.get(meta.category);
		if (current === undefined || audienceRank(role) < audienceRank(current)) {
			categoryMinRole.set(meta.category, role);
		}
	}

	// Upsert categories
	const categoryIdMap = new Map<string, string>();
	for (const slug of categorySlugs) {
		const minRole = categoryMinRole.get(slug) ?? 'member';
		const existing = await db
			.select({ id: helpCategory.id })
			.from(helpCategory)
			.where(eq(helpCategory.slug, slug))
			.limit(1);

		if (existing.length > 0) {
			// Update rather than only mapping the id — categories created before
			// minRole was derived would otherwise keep the 'member' default forever.
			await db.update(helpCategory).set({ minRole }).where(eq(helpCategory.id, existing[0].id));
			categoryIdMap.set(slug, existing[0].id);
		} else {
			const name = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
			const [cat] = await db
				.insert(helpCategory)
				.values({ name, slug, minRole, sortOrder: categoryIdMap.size })
				.returning();
			categoryIdMap.set(slug, cat.id);
			console.log(`  Created category: ${name} (${slug}, minRole=${minRole})`);
		}
	}

	// Upsert articles.
	//
	// Syncing never publishes. New articles land as drafts for a human to read
	// and publish from Staff -> Help, and an update deliberately leaves the
	// `published` column alone: re-syncing must not resurrect something a staff
	// member unpublished, nor silently publish a draft the moment its markdown
	// changes.
	const syncedSlugs: string[] = [];
	for (const { meta, body, capabilities } of articles) {
		const categoryId = categoryIdMap.get(meta.category)!;
		syncedSlugs.push(meta.slug);

		const existing = await db
			.select({ id: helpArticle.id })
			.from(helpArticle)
			.where(and(eq(helpArticle.slug, meta.slug), eq(helpArticle.source, 'static')))
			.limit(1);

		if (existing.length > 0) {
			await db
				.update(helpArticle)
				.set({
					title: meta.title,
					categoryId,
					summary: meta.summary ?? null,
					content: body,
					minRole: audienceOf(meta.minRole),
					capabilities,
					sortOrder: meta.sortOrder ?? 0,
					updatedAt: new Date()
				})
				.where(eq(helpArticle.id, existing[0].id));
			console.log(`  Updated: ${meta.title}`);
		} else {
			await db.insert(helpArticle).values({
				categoryId,
				title: meta.title,
				slug: meta.slug,
				summary: meta.summary ?? null,
				content: body,
				source: 'static',
				minRole: audienceOf(meta.minRole),
				capabilities,
				published: false,
				sortOrder: meta.sortOrder ?? 0
			});
			console.log(`  Created (draft): ${meta.title}`);
		}
	}

	// Remove orphaned static articles
	if (syncedSlugs.length > 0) {
		await db
			.delete(helpArticle)
			.where(and(eq(helpArticle.source, 'static'), notInArray(helpArticle.slug, syncedSlugs)));
		console.log(`  Cleaned up orphaned static articles`);
	}

	console.log('Done.');
}

function remoteCredentials(): D1HttpCredentials {
	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
	const token = process.env.CLOUDFLARE_D1_TOKEN;
	const databaseId = process.env.CLOUDFLARE_DATABASE_ID ?? databaseIdFromWrangler();
	if (!accountId || !token || !databaseId) {
		throw new Error('--remote needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_D1_TOKEN');
	}
	return { accountId, databaseId, token };
}

async function main() {
	const articles = readArticles();
	if (process.argv.includes('--remote')) {
		console.log('help:sync — writing to the remote (production) D1');
		return syncHelpArticles(drizzleProxy(d1HttpClient(remoteCredentials())), articles);
	}
	// Imported here: loading wrangler at the top breaks the spec's module graph.
	const { getPlatformProxy } = await import('wrangler');
	// `src/app.d.ts` is where this project's bindings are named; without the
	// type argument `env` is `unknown` and `env.DB` is unchecked.
	const { env, dispose } = await getPlatformProxy<NonNullable<App.Platform['env']>>();
	try {
		await syncHelpArticles(drizzle(env.DB), articles);
	} finally {
		await dispose();
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
