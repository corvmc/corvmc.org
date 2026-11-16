import { db } from '#lib/server/db/index.js';
import { directoryEntry } from '#lib/server/db/schema/directory.js';
import { eventBand } from '#lib/server/db/schema/event.js';
import { equipmentCategory, inventoryItem } from '#lib/server/db/schema/inventory.js';
import { rider, riderElement } from '#lib/server/db/schema/rider.js';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { getAvailableQuantityMany } from '#lib/server/inventory/stock-service.js';
import { DomainError } from '#lib/server/domain-error.js';
import { riderElementKinds, type RiderElementKind } from '#lib/config.js';
import type { RiderStockCheck, RiderStockLine, RiderStockMatch } from '#lib/types/rider-stock.js';

export type { RiderStockCheck, RiderStockLine, RiderStockMatch };

/** One 404 for an element or item that is not there, so neither can be probed. */
export class RiderStockTargetNotFoundError extends DomainError {
	readonly httpStatus = 404;
	constructor() {
		super('That rider item or catalog item was not found');
	}
}

/**
 * Words that start an `equipment_category` name serving each rider kind.
 *
 * A suggestion only: categories are free text staff name, and a rider kind is
 * a fixed list, so nothing ties the two. A staff-set link always wins.
 */
export const KIND_CATEGORY_HINTS: Record<RiderElementKind, readonly string[]> = {
	drum_kit: ['drum'],
	percussion: ['percussion', 'drum'],
	bass_rig: ['bass', 'amp'],
	guitar_amp: ['amp', 'guitar amp'],
	keys: ['key', 'piano', 'synth'],
	playback: ['playback', 'interface', 'di'],
	vocals: ['mic', 'vocal'],
	monitor: ['monitor', 'wedge', 'speaker'],
	other: []
};

/** A hint matches when some word of the category name starts with it. */
export function categoryServesKind(categoryName: string, kind: RiderElementKind): boolean {
	const words = categoryName.toLowerCase().split(/[^a-z0-9]+/);
	return KIND_CATEGORY_HINTS[kind].some((hint) => words.some((w) => w.startsWith(hint)));
}

/**
 * Each `venue` element on a bill's riders against the catalog.
 *
 * Demand is counted **per act**, not summed across the bill: acts on one night
 * share the backline between sets, so three acts each asking for a vocal mic
 * need one mic, not three.
 */
export async function getEventRiderStock(eventId: string): Promise<RiderStockCheck> {
	const [rows, catalogRows] = await Promise.all([
		db
			.select({
				elementId: riderElement.id,
				groupId: rider.groupId,
				actName: eventBand.name,
				billingOrder: eventBand.billingOrder,
				label: riderElement.label,
				kind: riderElement.kind,
				sortOrder: riderElement.sortOrder,
				itemId: inventoryItem.id,
				itemName: inventoryItem.name
			})
			.from(eventBand)
			.innerJoin(directoryEntry, eq(directoryEntry.id, eventBand.directoryEntryId))
			.innerJoin(rider, eq(rider.groupId, directoryEntry.groupId))
			.innerJoin(riderElement, eq(riderElement.riderId, rider.id))
			// A link to a retired catalog row reads as no link.
			.leftJoin(
				inventoryItem,
				and(eq(inventoryItem.id, riderElement.inventoryItemId), isNull(inventoryItem.deletedAt))
			)
			.where(and(eq(eventBand.eventId, eventId), eq(riderElement.providedBy, 'venue')))
			.orderBy(asc(eventBand.billingOrder)),
		db
			.select({
				id: inventoryItem.id,
				name: inventoryItem.name,
				categoryId: equipmentCategory.id,
				categoryName: equipmentCategory.name
			})
			.from(inventoryItem)
			.innerJoin(equipmentCategory, eq(equipmentCategory.id, inventoryItem.categoryId))
			.where(isNull(inventoryItem.deletedAt))
			.orderBy(asc(equipmentCategory.displayOrder), asc(inventoryItem.name))
	]);

	// An act billed twice brings one rider; its first credit speaks for it.
	const elements = rows
		.filter((r, i, all) => all.findIndex((o) => o.elementId === r.elementId) === i)
		.sort(
			(a, b) =>
				a.billingOrder - b.billingOrder ||
				riderElementKinds.indexOf(a.kind) - riderElementKinds.indexOf(b.kind) ||
				a.sortOrder - b.sortOrder
		);

	const categories = new Map<string, { id: string; name: string; itemIds: string[] }>();
	for (const item of catalogRows) {
		const cat = categories.get(item.categoryId) ?? {
			id: item.categoryId,
			name: item.categoryName,
			itemIds: []
		};
		cat.itemIds.push(item.id);
		categories.set(item.categoryId, cat);
	}
	const available = await getAvailableQuantityMany(catalogRows.map((c) => c.id));
	const sum = (ids: string[]) => ids.reduce((n, id) => n + (available.get(id) ?? 0), 0);

	const matched = elements.map((el) => {
		let match: RiderStockMatch | null = null;
		if (el.itemId && el.itemName) {
			match = { via: 'link', itemId: el.itemId, itemName: el.itemName };
		} else {
			const cat = [...categories.values()].find((c) => categoryServesKind(c.name, el.kind));
			if (cat) match = { via: 'category', categoryId: cat.id, categoryName: cat.name };
		}
		const key = match ? (match.via === 'link' ? match.itemId : `cat:${match.categoryId}`) : null;
		return { el, match, key };
	});

	const lines: RiderStockLine[] = matched.map(({ el, match, key }) => {
		const needed = key
			? matched.filter((m) => m.key === key && m.el.groupId === el.groupId).length
			: 1;
		const free = !match
			? null
			: match.via === 'link'
				? (available.get(match.itemId) ?? 0)
				: sum(categories.get(match.categoryId)?.itemIds ?? []);
		return {
			elementId: el.elementId,
			actName: el.actName,
			label: el.label,
			kind: el.kind,
			match,
			needed,
			available: free,
			short: free !== null && needed > free
		};
	});

	return {
		lines,
		unmatchedCount: lines.filter((l) => !l.match).length,
		shortCount: lines.filter((l) => l.short).length,
		catalog: catalogRows.map((c) => ({ id: c.id, name: c.name, categoryName: c.categoryName }))
	};
}

/**
 * Point a rider element at a catalog item, or clear it back to the category
 * suggestion with `itemId: null`. The element has to be on this event's bill,
 * which is what keeps one show's runner off every other band's rider.
 */
export async function setRiderElementStock(input: {
	eventId: string;
	elementId: string;
	itemId: string | null;
}): Promise<void> {
	const [onBill] = await db
		.select({ id: riderElement.id })
		.from(riderElement)
		.innerJoin(rider, eq(rider.id, riderElement.riderId))
		.innerJoin(directoryEntry, eq(directoryEntry.groupId, rider.groupId))
		.innerJoin(eventBand, eq(eventBand.directoryEntryId, directoryEntry.id))
		.where(and(eq(riderElement.id, input.elementId), eq(eventBand.eventId, input.eventId)))
		.limit(1);
	if (!onBill) throw new RiderStockTargetNotFoundError();

	if (input.itemId) {
		const [item] = await db
			.select({ id: inventoryItem.id })
			.from(inventoryItem)
			.where(and(eq(inventoryItem.id, input.itemId), isNull(inventoryItem.deletedAt)))
			.limit(1);
		if (!item) throw new RiderStockTargetNotFoundError();
	}

	await db
		.update(riderElement)
		.set({ inventoryItemId: input.itemId })
		.where(eq(riderElement.id, input.elementId));
}
