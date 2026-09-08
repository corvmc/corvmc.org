/**
 * Sync static help articles from src/content/help/ into the database.
 *
 * Usage:
 *   pnpm help:sync
 *
 * Reads markdown files with frontmatter, upserts them as help articles
 * with source='static', and removes orphaned static rows.
 */
import 'dotenv/config';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { getPlatformProxy } from 'wrangler';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, notInArray } from 'drizzle-orm';
import { helpCategory, helpArticle } from '../src/lib/server/db/schema/help';
import { helpAudiences } from '../src/lib/config';

const CONTENT_DIR = join(import.meta.dirname, '../src/content/help');

interface ArticleFrontmatter {
	title: string;
	slug: string;
	category: string;
	summary?: string;
	minRole?: string;
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

async function main() {
	// `src/app.d.ts` is where this project's bindings are named; without the
	// type argument `env` is `unknown` and `env.DB` is unchecked.
	const { env, dispose } = await getPlatformProxy<NonNullable<App.Platform['env']>>();
	const db = drizzle(env.DB);

	const files = findMarkdownFiles(CONTENT_DIR);
	console.log(`Found ${files.length} markdown file(s) in ${CONTENT_DIR}`);

	// Ensure categories exist
	const categorySlugs = new Set<string>();
	const articles: { meta: ArticleFrontmatter; body: string; file: string }[] = [];

	for (const file of files) {
		const raw = readFileSync(file, 'utf-8');
		const { meta, body } = parseFrontmatter(raw);
		categorySlugs.add(meta.category);
		articles.push({ meta, body, file: relative(CONTENT_DIR, file) });
	}

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
	for (const { meta, body } of articles) {
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
	await dispose();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
