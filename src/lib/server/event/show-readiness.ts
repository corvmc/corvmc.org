import type { ProductionStatus } from '$lib/server/db/schema/production';

/**
 * The facts about a show that two readers check: the publish gate
 * (`publishBlockers`) and a committee deliverable's done condition
 * (`volunteer/done-conditions.ts`). One definition each, so the gate and the
 * deliverable cannot disagree about whether a show has a poster.
 */

/** A lineup that is agreed, or a night that has already happened. */
export const CONFIRMED_PRODUCTION_STATUSES = [
	'confirmed',
	'completed',
	'settled',
	'closed'
] as const satisfies readonly ProductionStatus[];

export const SETTLED_PRODUCTION_STATUSES = [
	'settled',
	'closed'
] as const satisfies readonly ProductionStatus[];

export function isProductionConfirmed(status: string | null | undefined): boolean {
	return (CONFIRMED_PRODUCTION_STATUSES as readonly string[]).includes(status ?? '');
}

export function isProductionSettled(status: string | null | undefined): boolean {
	return (SETTLED_PRODUCTION_STATUSES as readonly string[]).includes(status ?? '');
}

/** `posterKey` as `eventPosterKeySql` resolves it. */
export function hasPoster(posterKey: string | null | undefined): boolean {
	return !!posterKey;
}

export function hasDescription(description: string | null | undefined): boolean {
	return !!description?.trim();
}

/**
 * What a CMC listing is still missing before the public sees it, in the words
 * the publish dialog shows. Community listings are exempt: a member posting
 * somebody else's gig makes no promise on the collective's behalf.
 */
export function showBlockers(row: {
	source: string;
	productionStatus: string | null;
	posterKey: string | null;
	description: string | null;
}): string[] {
	if (row.source !== 'cmc') return [];
	const warnings: string[] = [];
	if (row.productionStatus && !isProductionConfirmed(row.productionStatus)) {
		warnings.push('the production is not confirmed yet');
	}
	if (!hasPoster(row.posterKey)) warnings.push('there is no poster');
	if (!hasDescription(row.description)) warnings.push('there is no description');
	return warnings;
}
