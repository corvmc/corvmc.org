import { recordEntry } from './financial-entry-service';
import type { AcquisitionKind } from '$lib/config';

/**
 * A donated acquisition's value, as a financial entry.
 *
 * Written as a **delta**: the ledger is append-only and a gift is routinely
 * valued after it arrives, so re-valuing adds the difference rather than
 * restating the month it landed in. A kind changed away from `donation`
 * reverses the whole of it — the goods were bought, not given.
 */
export async function syncAcquisitionInKind(params: {
	acquisitionId: string;
	before: { kind: AcquisitionKind; fairValueCents: number | null } | null;
	after: { kind: AcquisitionKind; fairValueCents: number | null };
	description: string;
	donorUserId?: string | null;
	occurredAt: Date;
	recordedByUserId?: string | null;
}): Promise<void> {
	const valueOf = (s: { kind: AcquisitionKind; fairValueCents: number | null } | null) =>
		s && s.kind === 'donation' ? (s.fairValueCents ?? 0) : 0;

	const delta = valueOf(params.after) - valueOf(params.before);
	if (delta === 0) return;

	await recordEntry({
		amountCents: delta,
		kind: 'in_kind',
		category: 'donation',
		// When the goods arrived, not when somebody priced them.
		occurredAt: params.occurredAt,
		settlement: 'none',
		subjectType: 'acquisition',
		subjectId: params.acquisitionId,
		userId: params.donorUserId ?? null,
		recordedByUserId: params.recordedByUserId ?? null,
		description: params.description,
		metadata: {
			fairValueCents: params.after.fairValueCents,
			previousFairValueCents: params.before?.fairValueCents ?? null
		}
	});
}

/**
 * What a purchased acquisition cost.
 *
 * The receipt total wins over the lines, which is the rule the register
 * already follows everywhere it shows a figure: postage and tax are on the
 * paper and never on a line. A delta again, because the total arrives after
 * the receipt as often as with it.
 */
export async function syncAcquisitionSpend(params: {
	acquisitionId: string;
	before: { kind: AcquisitionKind; totalCents: number | null } | null;
	after: { kind: AcquisitionKind; totalCents: number | null };
	description: string;
	occurredAt: Date;
	recordedByUserId?: string | null;
	projectId?: string | null;
}): Promise<void> {
	const spendOf = (s: { kind: AcquisitionKind; totalCents: number | null } | null) =>
		s && s.kind === 'purchase' ? (s.totalCents ?? 0) : 0;

	const delta = spendOf(params.after) - spendOf(params.before);
	if (delta === 0) return;

	await recordEntry({
		// Negative: money out.
		amountCents: -delta,
		kind: 'spent',
		category: 'equipment',
		occurredAt: params.occurredAt,
		settlement: 'none',
		subjectType: 'acquisition',
		subjectId: `${params.acquisitionId}:spend`,
		projectId: params.projectId ?? null,
		recordedByUserId: params.recordedByUserId ?? null,
		description: params.description,
		metadata: { totalCents: params.after.totalCents }
	});
}
