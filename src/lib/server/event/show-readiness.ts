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
