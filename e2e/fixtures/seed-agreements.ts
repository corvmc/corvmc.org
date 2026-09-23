/**
 * Two agreements: a grant with an application deadline ahead, and a sponsorship
 * whose report is overdue. Dated relative to today so both stay true.
 *
 * Idempotent: deletes and recreates its own rows on every run.
 */
import { inArray } from 'drizzle-orm';
import { withPlatformEnv } from './platform-db';
import { agreement } from '../../src/lib/server/db/schema/agreement';

export const SEED_AGREEMENT_GRANT_ID = 'e2e-agreement-grant';
export const SEED_AGREEMENT_GRANT_COUNTERPARTY = 'E2E Arts Council';

export const SEED_AGREEMENT_OVERDUE_ID = 'e2e-agreement-overdue';
export const SEED_AGREEMENT_OVERDUE_COUNTERPARTY = 'E2E Guitar Shop';

function day(offset: number): string {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() + offset);
	return d.toISOString().slice(0, 10);
}

export async function seedAgreements(): Promise<void> {
	await withPlatformEnv(async ({ db }) => {
		await db
			.delete(agreement)
			.where(inArray(agreement.id, [SEED_AGREEMENT_GRANT_ID, SEED_AGREEMENT_OVERDUE_ID]));

		await db.insert(agreement).values([
			{
				id: SEED_AGREEMENT_GRANT_ID,
				kind: 'grant',
				counterparty: SEED_AGREEMENT_GRANT_COUNTERPARTY,
				title: 'Operating support',
				status: 'prospect',
				amountCents: 250_000,
				applyBy: day(30)
			},
			{
				id: SEED_AGREEMENT_OVERDUE_ID,
				kind: 'sponsorship',
				counterparty: SEED_AGREEMENT_OVERDUE_COUNTERPARTY,
				title: 'Season sponsor',
				status: 'active',
				tier: 'Gold',
				startsOn: day(-100),
				endsOn: day(100),
				reportDueOn: day(-5)
			}
		]);
	});
}
