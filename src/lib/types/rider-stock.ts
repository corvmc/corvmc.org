import type { RiderElementKind } from '#lib/config.js';

/** A rider's `venue` elements against the catalog, for the advance (#2724). */
export type RiderStockMatch =
	| { via: 'link'; itemId: string; itemName: string }
	| { via: 'category'; categoryId: string; categoryName: string };

export interface RiderStockLine {
	elementId: string;
	actName: string;
	label: string;
	kind: RiderElementKind;
	/** Null is the unmatched case: nothing in the catalog answers it. */
	match: RiderStockMatch | null;
	/** How many of this act's requests share the match. */
	needed: number;
	/** Units free now for the match; null when unmatched. */
	available: number | null;
	short: boolean;
}

export interface RiderStockCheck {
	lines: RiderStockLine[];
	unmatchedCount: number;
	shortCount: number;
	/** The catalog, for the link picker. */
	catalog: { id: string; name: string; categoryName: string }[];
}
