/**
 * A sponsor whose term has lapsed, and a funder with an award running and an
 * application deadline ahead. Each row has its project, as the services write
 * them (#2622). Dated relative to today.
 *
 * Idempotent: deletes and recreates its own rows on every run.
 */
import { eq, inArray } from 'drizzle-orm';
import { withPlatformEnv } from './platform-db';
import { sponsorship } from '../../src/lib/server/db/schema/sponsor';
import { grantApplication } from '../../src/lib/server/db/schema/grant';
import { project } from '../../src/lib/server/db/schema/project';
import { workOrder } from '../../src/lib/server/db/schema/volunteer';
import { organization } from '../../src/lib/server/db/schema/party';
import { partyRole } from '../../src/lib/server/db/schema/contact';

export const SEED_SPONSOR_ID = 'e2e-sponsor';
export const SEED_SPONSOR_NAME = 'E2E Guitar Shop';
export const SEED_LAPSED_SPONSORSHIP_TITLE = 'Season sponsor';

export const SEED_FUNDER_ID = 'e2e-funder';
export const SEED_FUNDER_NAME = 'E2E Arts Council';
export const SEED_GRANT_OVERDUE_ID = 'e2e-grant-overdue';
export const SEED_GRANT_OVERDUE_TITLE = 'E2E soundproofing';
export const SEED_GRANT_PROSPECT_TITLE = 'E2E operating support';

function day(offset: number): string {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() + offset);
	return d.toISOString().slice(0, 10);
}

export async function seedSponsorsAndGrants(): Promise<void> {
	await withPlatformEnv(async ({ db }) => {
		// Every project these organizations' rows hold, a spec's new grant's included.
		const held = [
			...(await db
				.select({ id: sponsorship.projectId })
				.from(sponsorship)
				.where(eq(sponsorship.organizationId, SEED_SPONSOR_ID))),
			...(await db
				.select({ id: grantApplication.projectId })
				.from(grantApplication)
				.where(eq(grantApplication.organizationId, SEED_FUNDER_ID)))
		].flatMap((r) => (r.id ? [r.id] : []));
		await db.delete(sponsorship).where(eq(sponsorship.organizationId, SEED_SPONSOR_ID));
		await db.delete(grantApplication).where(eq(grantApplication.organizationId, SEED_FUNDER_ID));
		if (held.length > 0) {
			await db.delete(workOrder).where(inArray(workOrder.projectId, held));
			await db.delete(project).where(inArray(project.id, held));
		}
		// Roles cascade with their organization.
		await db
			.delete(organization)
			.where(inArray(organization.id, [SEED_SPONSOR_ID, SEED_FUNDER_ID]));

		await db.insert(organization).values([
			{ id: SEED_SPONSOR_ID, name: SEED_SPONSOR_NAME },
			{ id: SEED_FUNDER_ID, name: SEED_FUNDER_NAME }
		]);
		await db.insert(partyRole).values([
			{ organizationId: SEED_SPONSOR_ID, role: 'sponsor' },
			{ organizationId: SEED_FUNDER_ID, role: 'funder' }
		]);
		await db.insert(project).values([
			{ id: 'e2e-sponsorship-project', name: SEED_LAPSED_SPONSORSHIP_TITLE, kind: 'sponsorship' },
			{ id: 'e2e-grant-overdue-project', name: SEED_GRANT_OVERDUE_TITLE, kind: 'grant' },
			{ id: 'e2e-grant-prospect-project', name: SEED_GRANT_PROSPECT_TITLE, kind: 'grant' }
		]);
		await db.insert(sponsorship).values({
			projectId: 'e2e-sponsorship-project',
			organizationId: SEED_SPONSOR_ID,
			title: SEED_LAPSED_SPONSORSHIP_TITLE,
			tier: 'Gold',
			status: 'active',
			startsOn: day(-100),
			endsOn: day(-5)
		});

		await db.insert(grantApplication).values([
			{
				id: SEED_GRANT_OVERDUE_ID,
				projectId: 'e2e-grant-overdue-project',
				organizationId: SEED_FUNDER_ID,
				title: SEED_GRANT_OVERDUE_TITLE,
				status: 'awarded',
				startsOn: day(-100),
				endsOn: day(100)
			},
			{
				id: 'e2e-grant-prospect',
				projectId: 'e2e-grant-prospect-project',
				organizationId: SEED_FUNDER_ID,
				title: SEED_GRANT_PROSPECT_TITLE,
				status: 'prospect',
				applyBy: day(30)
			}
		]);
	});
}
