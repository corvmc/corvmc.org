/**
 * A sponsor whose term has lapsed, and a funder with an overdue report on one
 * award and an application deadline ahead on another. Dated relative to today.
 *
 * Idempotent: deletes and recreates its own rows on every run.
 */
import { eq, inArray } from 'drizzle-orm';
import { withPlatformEnv } from './platform-db';
import { sponsor, sponsorship } from '../../src/lib/server/db/schema/sponsor';
import { funder, grantApplication, grantReport } from '../../src/lib/server/db/schema/grant';

export const SEED_SPONSOR_ID = 'e2e-sponsor';
export const SEED_SPONSOR_NAME = 'E2E Guitar Shop';

export const SEED_FUNDER_ID = 'e2e-funder';
export const SEED_FUNDER_NAME = 'E2E Arts Council';
export const SEED_GRANT_OVERDUE_ID = 'e2e-grant-overdue';
export const SEED_GRANT_OVERDUE_TITLE = 'E2E soundproofing';
export const SEED_GRANT_PROSPECT_TITLE = 'E2E operating support';
/** Owned by the spec that submits its report; nothing else reads it. */
export const SEED_GRANT_SUBMIT_ID = 'e2e-grant-submit';

function day(offset: number): string {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() + offset);
	return d.toISOString().slice(0, 10);
}

export async function seedSponsorsAndGrants(): Promise<void> {
	await withPlatformEnv(async ({ db }) => {
		await db.delete(sponsorship).where(eq(sponsorship.sponsorId, SEED_SPONSOR_ID));
		await db.delete(sponsor).where(eq(sponsor.id, SEED_SPONSOR_ID));
		// Reports cascade with their application.
		await db.delete(grantApplication).where(eq(grantApplication.funderId, SEED_FUNDER_ID));
		await db.delete(funder).where(inArray(funder.id, [SEED_FUNDER_ID]));

		await db.insert(sponsor).values({ id: SEED_SPONSOR_ID, name: SEED_SPONSOR_NAME });
		await db.insert(sponsorship).values({
			sponsorId: SEED_SPONSOR_ID,
			title: 'Season sponsor',
			tier: 'Gold',
			status: 'active',
			startsOn: day(-100),
			endsOn: day(-5)
		});

		await db.insert(funder).values({ id: SEED_FUNDER_ID, name: SEED_FUNDER_NAME });
		await db.insert(grantApplication).values([
			{
				id: SEED_GRANT_OVERDUE_ID,
				funderId: SEED_FUNDER_ID,
				title: SEED_GRANT_OVERDUE_TITLE,
				status: 'awarded',
				startsOn: day(-100),
				endsOn: day(100)
			},
			{
				id: 'e2e-grant-prospect',
				funderId: SEED_FUNDER_ID,
				title: SEED_GRANT_PROSPECT_TITLE,
				status: 'prospect',
				applyBy: day(30)
			},
			{
				id: SEED_GRANT_SUBMIT_ID,
				funderId: SEED_FUNDER_ID,
				title: 'E2E report to submit',
				status: 'awarded',
				endsOn: day(100)
			}
		]);
		await db.insert(grantReport).values([
			{ grantApplicationId: SEED_GRANT_OVERDUE_ID, title: 'Interim report', dueOn: day(-5) },
			{ grantApplicationId: SEED_GRANT_SUBMIT_ID, title: 'Interim report', dueOn: day(-5) }
		]);
	});
}
