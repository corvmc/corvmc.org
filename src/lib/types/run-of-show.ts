/**
 * The run of show as the console reads it.
 *
 * Here rather than beside the service because a `.svelte` file cannot reach
 * `$lib/server`. `run-of-show-service` asserts at compile time that its own
 * `EventBandStatus` still fits `RunOfShowActStatus`, so the copy below cannot
 * drift from the schema's vocabulary in silence.
 */

import type { ActTerms } from '$lib/production/terms';

export type RunOfShowActStatus = 'unlinked' | 'pending' | 'confirmed' | 'declined';

export type RunOfShowWarningCode =
	'past_curfew' | 'before_doors' | 'set_too_long' | 'soundcheck_after_first_set';

export interface RunOfShowWarning {
	code: RunOfShowWarningCode;
	message: string;
	/** Null for a warning about the night as a whole. */
	slotId: string | null;
}

export interface RunOfShowSlot {
	id: string;
	eventBandId: string | null;
	/** From `event_band`. Null once the credit is off the bill. */
	actName: string | null;
	actStatus: RunOfShowActStatus | null;
	/** The band's page on CMC, when the credit names a member band. */
	actSlug: string | null;
	sortOrder: number;
	setLengthMinutes: number;
	changeoverMinutes: number;
	scheduledStartAt: Date | null;
	/** Derived on read — start plus length, and nothing stored. */
	scheduledEndAt: Date | null;
	soundcheckAt: Date | null;
	techNotes: string | null;
	backlineNeeds: string | null;
	hospitalityNotes: string | null;
	contactName: string | null;
	contactEmail: string | null;
	contactPhone: string | null;
	/** What this act is paid. Per act, because a headliner and an opener differ. */
	terms: ActTerms;
}

export interface RunOfShow {
	productionId: string;
	firstSetAt: Date | null;
	curfewAt: Date | null;
	slots: RunOfShowSlot[];
	/** Credits on the bill with no set yet — what the add picker offers. */
	unslotted: { eventBandId: string; name: string; billingOrder: number }[];
	warnings: RunOfShowWarning[];
}

/** One line of the published running order. */
export interface PublicSetTime {
	name: string;
	scheduledStartAt: Date;
}
