import { inventoryItem } from '#lib/server/db/schema/inventory.js';
import { and, eq, or } from 'drizzle-orm';
import type { InventorySection } from '#lib/config.js';

/**
 * Gear is `kind = 'serialized' OR is_loanable`; Supplies is the rest, the
 * consumable definition `kind = 'bulk' AND NOT is_loanable`. The two are
 * exhaustive and disjoint. `sectionOf` and `inSection` must agree: lists filter
 * with one and rows are labelled with the other. `sections.spec.ts` pins both.
 */
export function sectionOf(item: { kind: string; isLoanable: boolean }): InventorySection {
	return item.kind === 'serialized' || item.isLoanable ? 'gear' : 'supplies';
}

/** The `WHERE` term for a section's items. */
export function inSection(section: InventorySection) {
	return section === 'gear'
		? or(eq(inventoryItem.kind, 'serialized'), eq(inventoryItem.isLoanable, true))
		: and(eq(inventoryItem.kind, 'bulk'), eq(inventoryItem.isLoanable, false));
}
