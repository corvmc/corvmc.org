import { db } from '#lib/server/db/index.js';
import { sql } from 'drizzle-orm';
import type { SQLiteTable, SQLiteColumn } from 'drizzle-orm/sqlite-core';

/**
 * Generate a URL-friendly slug from a string.
 *
 * Lowercases, then **drops** anything that isn't a letter, digit or hyphen —
 * slug generation never introduces a hyphen of its own. 'Rock & Roll' is
 * `rockroll`, not `rock-roll`. Hyphens already in the source survive, with runs
 * collapsed and the ends trimmed, so 'Sun-Ra' stays `sun-ra`.
 */
export function generateSlug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '')
		.replace(/-{2,}/g, '-')
		.replace(/^-|-$/g, '');
}

/** Stands in for a name that slugifies to nothing. Shared by every caller. */
const FALLBACK_SLUG = 'untitled';

/**
 * Ensure a slug is unique within a table by appending -2, -3, etc. if needed.
 *
 * Pass `exclude` when re-slugging an existing row so its own current slug does
 * not count as a collision — without it, every save that touches the name
 * rotates the slug (e.g. 'my-band' → 'my-band-2'), breaking inbound links.
 *
 * Pass `isDisallowed` to block additional slugs (e.g. reserved subdomains) —
 * disallowed values are skipped like collisions.
 */
export async function ensureUniqueSlug(
	baseSlug: string,
	table: SQLiteTable,
	column: SQLiteColumn,
	exclude?: { column: SQLiteColumn; value: string },
	isDisallowed?: (slug: string) => boolean
): Promise<string> {
	// `generateSlug` keeps only [a-z0-9], so a name in any non-Latin script (or
	// made of punctuation or emoji) reduces to ''. An empty slug is not NULL, so
	// it inserts happily and leaves the row unreachable — every /<slug> route
	// 404s, the {slug}.corvmc.org reroute breaks, and callers that redirect on a
	// truthy slug silently do nothing. Fall back before the collision loop so the
	// suffixes read 'untitled-2' rather than a bare '-2'.
	baseSlug = baseSlug || FALLBACK_SLUG;

	let slug = baseSlug;
	let suffix = 2;

	while (true) {
		if (!isDisallowed?.(slug)) {
			const [existing] = await db
				.select({ count: sql<number>`count(*)` })
				.from(table)
				.where(
					exclude
						? sql`${column} = ${slug} and ${exclude.column} != ${exclude.value}`
						: sql`${column} = ${slug}`
				);

			if (!existing || Number(existing.count) === 0) return slug;
		}
		slug = `${baseSlug}-${suffix}`;
		suffix++;
	}
}
