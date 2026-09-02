import { db } from '$lib/server/db';
import { inventoryItemArticle } from '$lib/server/db/schema/inventory';
import { helpArticle } from '$lib/server/db/schema/help';
import { asc, eq } from 'drizzle-orm';
import { listFor } from '$lib/server/media/media-service';
import { resolveImageUrl } from '$lib/server/storage';
import { raiseFlag } from './asset-flag-service';

/**
 * What is attached to a thing: documentation on the catalog entry, and evidence
 * on the individual unit.
 *
 * Both go through the shared media layer rather than a table of this module's
 * own. An earlier draft of the spec called for `inventory_document`, justified
 * on there being no generic attachment table — #289 landed one, so the whole of
 * this module's file handling is two new values in `attachableTypes` and two in
 * `mediaSlots`, and the hard part (an R2 object outliving the row that points at
 * it) is already solved.
 *
 * The split is by **what the resource describes**. A manual is the same for
 * every unit of an item, so it hangs off `inventory_item`. A photograph of a
 * cracked cabinet is about one amp, so it hangs off `inventory_asset`.
 */

// ---------------------------------------------------------------------------
// Item documentation
// ---------------------------------------------------------------------------

/** Manuals and spec sheets for a catalog entry, plus the how-tos linked to it. */
export async function listItemResources(itemId: string) {
	const [manuals, articles] = await Promise.all([
		listFor('inventory_item', itemId, 'manual'),
		db
			.select({
				linkId: inventoryItemArticle.id,
				sortOrder: inventoryItemArticle.sortOrder,
				id: helpArticle.id,
				title: helpArticle.title,
				slug: helpArticle.slug,
				summary: helpArticle.summary,
				published: helpArticle.published,
				minRole: helpArticle.minRole
			})
			.from(inventoryItemArticle)
			.innerJoin(helpArticle, eq(inventoryItemArticle.articleId, helpArticle.id))
			.where(eq(inventoryItemArticle.itemId, itemId))
			.orderBy(asc(inventoryItemArticle.sortOrder), asc(helpArticle.title))
	]);

	// The URL is resolved here rather than in the component: `resolveImageUrl`
	// lives in `$lib/server/`, which components may not import.
	return {
		manuals: manuals.map((m) => ({ ...m, url: resolveImageUrl(m.key) })),
		articles
	};
}

/**
 * What a member is allowed to see.
 *
 * Unpublished articles are drafts — help sync imports as drafts for staff
 * review — so showing one from a scanned tag would leak an unreviewed page to
 * whoever picked up the amp.
 */
export async function listMemberItemResources(itemId: string) {
	const { manuals, articles } = await listItemResources(itemId);
	return { manuals, articles: articles.filter((a) => a.published) };
}

export async function linkArticle(itemId: string, articleId: string) {
	const [row] = await db
		.insert(inventoryItemArticle)
		.values({ itemId, articleId })
		.onConflictDoNothing()
		.returning();
	return row ?? null;
}

export async function unlinkArticle(linkId: string) {
	await db.delete(inventoryItemArticle).where(eq(inventoryItemArticle.id, linkId));
}

/** Articles not yet linked to this item, for the picker. */
export async function listLinkableArticles(itemId: string) {
	const linked = await db
		.select({ articleId: inventoryItemArticle.articleId })
		.from(inventoryItemArticle)
		.where(eq(inventoryItemArticle.itemId, itemId));
	const taken = new Set(linked.map((l) => l.articleId));

	const all = await db
		.select({ id: helpArticle.id, title: helpArticle.title, published: helpArticle.published })
		.from(helpArticle)
		.orderBy(asc(helpArticle.title));

	return all.filter((a) => !taken.has(a.id));
}

// ---------------------------------------------------------------------------
// Damage reports
// ---------------------------------------------------------------------------

export interface ReportDamageInput {
	assetId: string;
	note: string;
	reportedByUserId: string;
	/** How bad, as judged by whoever found it. */
	condition?: 'fair' | 'poor';
	/** Whether the thing is unusable as it stands. */
	blocksUse?: boolean;
	/** Set when raised at re-uptake, against the loan it came back from. */
	loanId?: string | null;
}

/**
 * Someone found a unit broken.
 *
 * This used to be the whole system: the report *was* the status change, written
 * straight to the ledger with no row of its own. That had three costs — a second
 * reporter got an error, only the first was ever attributable, and an
 * observation not worth taking the unit out of service had nowhere to go.
 *
 * It now records an `asset_flag` and lets that decide. The ledger is unchanged
 * and still carries the `repair_out` when the unit actually leaves service; what
 * moved out of it is the part a movement cannot express, because a movement has
 * to move something.
 *
 * Kept as a named entry point rather than inlined at the call site: "a member
 * reported damage" is the story, and `raiseFlag` is the mechanism.
 */
export async function reportDamage(input: ReportDamageInput) {
	const flag = await raiseFlag({
		assetId: input.assetId,
		note: input.note,
		reportedByUserId: input.reportedByUserId,
		// Absent means the reporter did not say. Treated as blocking, which keeps
		// the old behaviour for every caller that has not been taught to ask: the
		// cost of a wrong pull is a staffer clicking it back, and the cost of
		// leaving a broken amp bookable is the next member's session.
		blocksUse: input.blocksUse ?? true,
		condition: input.condition ?? null,
		loanId: input.loanId ?? null
	});
	return { assetId: flag.assetId, flagId: flag.id };
}
