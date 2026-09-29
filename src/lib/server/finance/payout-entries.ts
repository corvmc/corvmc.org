import { recordEntries } from './financial-entry-service';
import { poolBalanceCents } from './financial-entry-service';
import { showProjectIdForProduction } from './show-project';

/**
 * Paying an act, in the ledger's terms.
 *
 * A ticket sale writes a positive `pass_through` row against the show's
 * settlement group — money the collective holds for the acts. Paying it out
 * writes the negative half, so `poolBalanceCents` walks toward zero and
 * "what does this show still owe" stays answerable from the record.
 */

export interface RecordActPayoutParams {
	eventId: string;
	productionId: string;
	slotId: string;
	actName: string;
	amountCents: number;
	occurredAt: Date;
	recordedByUserId: string;
}

/**
 * Two rows where the payout exceeds the pool, one where it does not.
 *
 * A guarantee on a soft night is the collective spending its own money, so the
 * part the pool covers is `pass_through` and the excess is `spent` under
 * `act_guarantee`.
 */
// Booking it all as pass-through would drive the pool negative, which already
// means a refund the collective absorbed.
export async function recordActPayout(params: RecordActPayoutParams): Promise<void> {
	if (params.amountCents <= 0) return;

	const held = await poolBalanceCents(params.eventId);
	const fromPool = Math.min(params.amountCents, Math.max(0, held));
	const topUp = params.amountCents - fromPool;

	const base = {
		occurredAt: params.occurredAt,
		// Cash or a cheque out of the till. Stripe never touches an act payout —
		// see the stripe-connect manual on why the collective is not a platform.
		settlement: 'cash' as const,
		subjectType: 'production' as const,
		subjectId: params.productionId,
		projectId: await showProjectIdForProduction(params.productionId),
		settlementGroup: params.eventId,
		recordedByUserId: params.recordedByUserId,
		metadata: { slotId: params.slotId, actName: params.actName }
	};

	await recordEntries([
		...(fromPool > 0
			? [
					{
						...base,
						amountCents: -fromPool,
						kind: 'pass_through' as const,
						category: 'act_payout' as const,
						description: `Paid ${params.actName} from the door`
					}
				]
			: []),
		...(topUp > 0
			? [
					{
						...base,
						amountCents: topUp,
						kind: 'spent' as const,
						category: 'act_guarantee' as const,
						description: `Guarantee top-up for ${params.actName}`
					}
				]
			: [])
	]);
}
