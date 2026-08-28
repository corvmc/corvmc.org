import { db } from '$lib/server/db';
import {
	inventoryAsset,
	inventoryItem,
	inventoryItemArticle
} from '$lib/server/db/schema/inventory';
import { helpArticle } from '$lib/server/db/schema/help';
import { and, asc, eq } from 'drizzle-orm';
import { listFor } from '$lib/server/media/media-service';
import { resolveImageUrl } from '$lib/server/storage';
import { recordMovement } from './stock-service';
import { AssetNotFoundError } from './asset-service';

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

export class AssetNotReportableError extends Error {
	constructor() {
		super('This unit is already out of service');
		this.name = 'AssetNotReportableError';
	}
}

export interface ReportDamageInput {
	assetId: string;
	note: string;
	reportedByUserId: string;
	/** How bad, as judged by whoever found it. */
	condition?: 'fair' | 'poor';
}

/**
 * Someone found a unit broken.
 *
 * A damage report is **a ledger entry, not a form system**: the asset's
 * condition changes and a `repair_out` movement carries the note and the
 * reporter. There is no separate report table and no queue, because the
 * movement history already is one — every repair a unit has been through is
 * already listed on its page in order.
 *
 * **It takes the unit out of service immediately**, on a member's say-so. That
 * is deliberate: the cost of a wrong report is a staffer setting it back, while
 * the cost of leaving a broken amp bookable is the next member's session. The
 * movement records `actorId`, so a pattern of bad reports is attributable.
 */
export async function reportDamage(input: ReportDamageInput) {
	const [asset] = await db
		.select()
		.from(inventoryAsset)
		.where(eq(inventoryAsset.id, input.assetId))
		.limit(1);

	if (!asset) throw new AssetNotFoundError();

	// Already in the shop, retired or lost: nothing useful to record, and the
	// member should be told rather than shown a form that changes nothing.
	if (asset.status !== 'in_service' && asset.status !== 'on_loan') {
		throw new AssetNotReportableError();
	}

	const now = new Date();
	await db
		.update(inventoryAsset)
		.set({
			status: 'maintenance',
			condition: input.condition ?? asset.condition,
			updatedAt: now
		})
		.where(eq(inventoryAsset.id, input.assetId));

	await recordMovement({
		itemId: asset.itemId,
		assetId: asset.id,
		quantity: 1,
		reason: 'repair_out',
		locationId: asset.locationId,
		actorId: input.reportedByUserId,
		occurredAt: now,
		notes: input.note
	});

	return { assetId: asset.id, itemId: asset.itemId };
}

/** Units a member reported, still awaiting a staffer. */
export async function listReportedDamage() {
	return db
		.select({ asset: inventoryAsset, item: inventoryItem })
		.from(inventoryAsset)
		.innerJoin(inventoryItem, eq(inventoryAsset.itemId, inventoryItem.id))
		.where(and(eq(inventoryAsset.status, 'maintenance')))
		.orderBy(asc(inventoryItem.name));
}
