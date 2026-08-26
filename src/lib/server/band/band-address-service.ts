/**
 * A band's address — the slug behind `{slug}.corvmc.org`, `/directory/bands/{slug}`
 * and `/band/{slug}`. Free for every band; the paid half of band addressing lives
 * in custom-domain-service.ts.
 *
 * The slug is derived from the name exactly once, at creation. After that it only
 * moves when an owner deliberately changes it here — renaming a band must never
 * silently relocate its public address.
 *
 * A released slug is recorded in `group_slug_history` and redirects to the band's
 * current address, but only for as long as nobody else claims it: a live
 * `band.slug` always shadows history, and claiming a slug deletes its history row.
 */
import { and, eq, isNull, ne } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { groupSlugHistory } from '$lib/server/db/schema/group';
import { group } from '$lib/server/db/schema/group';
import { generateSlug } from '$lib/server/utils/slug';
import { isReservedSlug } from '$lib/reserved-slugs';
import { forgetCustomDomain } from '$lib/server/band/band-host-service';
import { BandNotFoundError } from '$lib/server/band/band-service';

/** A DNS label cannot exceed 63 characters — a longer subdomain would not resolve. */
export const MAX_BAND_SLUG_LENGTH = 63;

/** Raised for anything that makes a requested address unusable, with a message safe to show the owner. */
export class SlugUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SlugUnavailableError';
	}
}

/**
 * Owner-typed input reduced to its canonical form: the same `generateSlug` the
 * rest of the app uses, so an address a band picks and one derived from its name
 * follow one rule. Spaces and punctuation are dropped rather than hyphenated —
 * "the velvets" reads as `thevelvets` — while hyphens typed on purpose survive.
 */
export function normalizeBandSlug(input: string): string {
	return generateSlug(input);
}

/**
 * Reject an address before touching the database. Pure, so the caller can run it
 * on a normalized value and surface the message as a field issue.
 *
 * The reserved check is load-bearing rather than cosmetic: `bandSlugFromHost`
 * refuses reserved slugs, so a band that acquired one would be permanently
 * unreachable at its own subdomain.
 */
export function assertValidBandSlug(slug: string): void {
	if (!slug) throw new SlugUnavailableError('Use at least one letter or number.');
	if (slug.length > MAX_BAND_SLUG_LENGTH) {
		throw new SlugUnavailableError(`Addresses can be at most ${MAX_BAND_SLUG_LENGTH} characters.`);
	}
	if (isReservedSlug(slug)) throw new SlugUnavailableError('That address is reserved.');
}

export type SlugResolution =
	| { kind: 'current'; slug: string }
	/** `slug` is the band's CURRENT address — where the requested one should redirect. */
	| { kind: 'moved'; slug: string }
	| null;

/**
 * What a slug points at today. The single lookup behind every old-address
 * redirect (the subdomain hook, the directory profile, the band dashboard and
 * the microsite loader), so the shadowing rule is written down once.
 */
export async function resolveBandSlug(slug: string): Promise<SlugResolution> {
	// No `deletedAt` filter: a soft-deleted band still occupies the unique index
	// on band.slug, so it shadows history exactly like a live one would.
	const [current] = await db
		.select({ slug: group.slug })
		.from(group)
		.where(eq(group.slug, slug))
		.limit(1);

	if (current) return { kind: 'current', slug: current.slug };

	// The join's `deletedAt` filter is what stops an old address from redirecting
	// into a deactivated band.
	const [moved] = await db
		.select({ slug: group.slug })
		.from(groupSlugHistory)
		.innerJoin(group, eq(group.id, groupSlugHistory.groupId))
		.where(and(eq(groupSlugHistory.slug, slug), isNull(group.deletedAt)))
		.limit(1);

	if (moved) return { kind: 'moved', slug: moved.slug };
	return null;
}

/** D1 surfaces SQLite's constraint text, so this is the only way to tell a lost race apart. */
function isUniqueConstraintError(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err ?? '');
	return /UNIQUE constraint failed/i.test(message);
}

/**
 * Move a band to a new address, recording the old one so it keeps redirecting.
 *
 * Uniqueness is checked against current band slugs only, never against history:
 * a released address is claimable, and the claim shadows the old owner's redirect.
 */
export async function changeBandSlug(
	bandId: string,
	requested: string
): Promise<{ status: 'unchanged' | 'changed'; slug: string; previousSlug: string }> {
	const [row] = await db
		.select({ id: group.id, slug: group.slug, customDomain: group.customDomain })
		.from(group)
		.where(eq(group.id, bandId))
		.limit(1);

	if (!row) throw new BandNotFoundError();

	const next = normalizeBandSlug(requested);
	assertValidBandSlug(next);

	if (next === row.slug) return { status: 'unchanged', slug: row.slug, previousSlug: row.slug };

	// No `deletedAt` filter — band.slug is globally unique, so a soft-deleted band
	// still holds its address and claiming it would trip a raw D1 constraint.
	const [taken] = await db
		.select({ id: group.id })
		.from(group)
		.where(and(eq(group.slug, next), ne(group.id, bandId)))
		.limit(1);

	if (taken) throw new SlugUnavailableError('That address is already taken.');

	try {
		// One batch, one implicit transaction (the same tool `create()` uses).
		// Order matters: claiming `next` has to clear any stale history row for it
		// before the old address is recorded, or the two would contradict.
		await db.batch([
			db.delete(groupSlugHistory).where(eq(groupSlugHistory.slug, next)),
			db
				.insert(groupSlugHistory)
				.values({ slug: row.slug, groupId: bandId })
				.onConflictDoUpdate({
					target: groupSlugHistory.slug,
					set: { groupId: bandId, createdAt: new Date() }
				}),
			db.update(group).set({ slug: next, updatedAt: new Date() }).where(eq(group.id, bandId))
		]);
	} catch (err) {
		// Two owners racing for the same free address: the loser trips the unique
		// index on band.slug, which D1 would otherwise surface as a 500.
		if (isUniqueConstraintError(err)) {
			throw new SlugUnavailableError('That address was just taken — try another.');
		}
		throw err;
	}

	// The router caches hostname → { slug, servesSite } for five minutes. Without
	// this purge a band with a custom domain keeps rerouting to /band-site/{old},
	// which 404s, on the address they paid for.
	if (row.customDomain) await forgetCustomDomain(row.customDomain);

	return { status: 'changed', slug: next, previousSlug: row.slug };
}
