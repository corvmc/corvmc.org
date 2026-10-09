import type { ProductionStatus } from '$lib/server/db/schema/production';

/**
 * A show's status, as warnings rather than a table of legal edges.
 *
 * Warn, record, allow (docs/development/conventions.md#workflow-gates): any
 * non-terminal status may move to any other once its warnings are
 * acknowledged, and only a terminal one refuses. Pure, so the console and the
 * service read the same answer.
 */

/** Read-only once reached. Leaving one is `reopenProduction`, never a transition. */
export const TERMINAL_PRODUCTION_STATUSES = ['closed', 'cancelled'] as const;

export function isTerminalProduction(status: ProductionStatus): boolean {
	return (TERMINAL_PRODUCTION_STATUSES as readonly string[]).includes(status);
}

/** The usual path. `offered` is optional: a show may be booked outright. */
const RANK: Record<Exclude<ProductionStatus, 'cancelled'>, number> = {
	draft: 0,
	offered: 0.5,
	confirmed: 1,
	completed: 2,
	settled: 3,
	closed: 4
};
const STEPS = ['draft', 'confirmed', 'completed', 'settled', 'closed'] as const;

export interface TransitionContext {
	/** Load-out tasks still open, by label. Only read for a move to `closed`. */
	outstandingCloseOut?: readonly string[];
}

export function transitionWarnings(
	from: ProductionStatus,
	to: ProductionStatus,
	ctx: TransitionContext = {}
): string[] {
	const warnings: string[] = [];
	if (from === to) return [`It is already ${to}.`];

	if (to === 'cancelled') {
		if (from !== 'cancelled' && RANK[from] >= RANK.completed) {
			warnings.push('This night already happened. Cancelling records it as called off.');
		}
	} else if (from !== 'cancelled') {
		const a = RANK[from];
		const b = RANK[to];
		// Pulling an offer back is the usual path's own mis-click fix.
		if (b < a && !(from === 'offered' && to === 'draft')) {
			warnings.push(`Moves back from ${from} to ${to}.`);
			if (a >= RANK.settled && b < RANK.settled) {
				warnings.push('The costs posted at settlement are reversed in the ledger.');
			}
		}
		const skipped = STEPS.filter((s) => RANK[s] > a && RANK[s] < b);
		if (skipped.length > 0) warnings.push(`Skips ${skipped.join(', ')}.`);
	}

	const open = ctx.outstandingCloseOut ?? [];
	if (to === 'closed' && open.length > 0) {
		const named = open.slice(0, 5).join(', ');
		const more = open.length > 5 ? ` and ${open.length - 5} more` : '';
		warnings.push(`Load-out is not finished: ${named}${more}.`);
	}
	return warnings;
}
