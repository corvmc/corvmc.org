import { contractor, contractorJob } from '../../src/lib/server/db/schema/contractor';
import { inventoryAsset } from '../../src/lib/server/db/schema/inventory';
import { batchInsert, db } from './db';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';

/**
 * The people the collective pays to do work, and the jobs they were paid for.
 *
 * Covers every trade and every job status, plus the three states the UI has to
 * render differently and would otherwise never be seen in: a job that is
 * overdue, a unit that is at the shop right now, and a contractor whose
 * insurance has lapsed.
 *
 * Assets are looked up by tag rather than threaded through from
 * `seedEquipment`, the same shortcut `seedItemArticles` takes — one join is not
 * worth a return value through two unrelated seeders.
 */
export async function seedContractors(staffId: string) {
	const now = new Date();
	const day = 24 * 3600_000;

	const ids = {
		amps: randomUUID(),
		electric: randomUUID(),
		plumb: randomUUID(),
		hvac: randomUUID(),
		fire: randomUUID(),
		lock: randomUUID(),
		handy: randomUUID(),
		piano: randomUUID()
	};

	const contractors = await batchInsert(
		contractor,
		[
			{
				id: ids.amps,
				name: 'Corvallis Amp Works',
				trade: 'instrument_repair' as const,
				contactName: 'Rita Alvarez',
				phone: '541-555-0143',
				email: 'shop@corvallisampworks.example',
				insuranceExpiresAt: new Date(now.getTime() + 200 * day),
				notes: 'Tube work and speaker reconing. Two-week turnaround in summer.'
			},
			{
				id: ids.electric,
				name: 'Benton Electric',
				trade: 'electrical' as const,
				contactName: 'Sam Okafor',
				phone: '541-555-0188',
				licenseNumber: 'OR-EL-44219',
				insuranceExpiresAt: new Date(now.getTime() + 21 * day),
				notes: 'Did the stage subpanel. Knows the building.'
			},
			{
				id: ids.plumb,
				name: 'Willamette Plumbing',
				trade: 'plumbing' as const,
				phone: '541-555-0107',
				insuranceExpiresAt: new Date(now.getTime() + 120 * day)
			},
			{
				id: ids.hvac,
				name: 'Mid-Valley Heating & Air',
				trade: 'hvac' as const,
				phone: '541-555-0166',
				// Lapsed a fortnight ago: the one row /staff/contractors must warn on.
				insuranceExpiresAt: new Date(now.getTime() - 14 * day),
				notes: 'Certificate of insurance expired — do not schedule until renewed.'
			},
			{
				id: ids.fire,
				name: 'Cascade Fire Safety',
				trade: 'fire_safety' as const,
				phone: '541-555-0121',
				insuranceExpiresAt: new Date(now.getTime() + 300 * day),
				notes: 'Annual extinguisher inspection.'
			},
			{
				id: ids.lock,
				name: 'Alsea Lock & Key',
				trade: 'locksmith' as const,
				phone: '541-555-0190'
				// No certificate on file at all — not the same as lapsed, and the
				// insurance list must leave it out.
			},
			{
				id: ids.handy,
				name: 'Dale Prescott',
				trade: 'general' as const,
				phone: '541-555-0134',
				notes: 'Handyman. Drywall, doors, shelving.'
			},
			{
				id: ids.piano,
				name: 'Marguerite Chen',
				trade: 'other' as const,
				phone: '541-555-0175',
				notes: 'Piano tuner. Twice a year.',
				// Retired from the pickers, but the tuning history stays.
				archivedAt: new Date(now.getTime() - 90 * day)
			}
		],
		4
	);

	// The unit `seedEquipment` left in the shop, and one still in service, so the
	// asset page has both an open job and a closed one to render.
	const [inShop] = await db
		.select({ id: inventoryAsset.id })
		.from(inventoryAsset)
		.where(eq(inventoryAsset.status, 'maintenance'))
		.limit(1);
	const [inService] = await db
		.select({ id: inventoryAsset.id })
		.from(inventoryAsset)
		.where(eq(inventoryAsset.status, 'in_service'))
		.limit(1);

	const jobs = await batchInsert(
		contractorJob,
		[
			// At the shop right now, and late — the overdue list's only row.
			{
				id: randomUUID(),
				contractorId: ids.amps,
				status: 'scheduled' as const,
				summary: 'Retube and rebias the Bassman',
				assetId: inShop?.id ?? null,
				scheduledFor: new Date(now.getTime() - 21 * day),
				expectedBackAt: new Date(now.getTime() - 5 * day),
				quotedCents: 22000,
				requestedByUserId: staffId,
				notes: 'Dropped off. Rita said two weeks.'
			},
			// A finished repair, with an invoice — the asset page's history.
			{
				id: randomUUID(),
				contractorId: ids.amps,
				status: 'completed' as const,
				summary: 'Recone the 4x10 cabinet',
				assetId: inService?.id ?? null,
				scheduledFor: new Date(now.getTime() - 150 * day),
				completedAt: new Date(now.getTime() - 132 * day),
				quotedCents: 16000,
				costCents: 17500,
				invoiceRef: 'CAW-4471',
				paidAt: new Date(now.getTime() - 125 * day),
				requestedByUserId: staffId
			},
			// Building work: no asset, which is the case the module exists for.
			{
				id: randomUUID(),
				contractorId: ids.electric,
				status: 'completed' as const,
				summary: 'Add a dedicated circuit for the stage subpanel',
				scheduledFor: new Date(now.getTime() - 60 * day),
				completedAt: new Date(now.getTime() - 60 * day),
				costCents: 94500,
				invoiceRef: 'BE-2026-118',
				paidAt: new Date(now.getTime() - 45 * day),
				requestedByUserId: staffId
			},
			// Donated: the trades half of contributed services. No `costCents`,
			// because nothing left the account -- the value is what the work
			// would have cost, carried separately so no `sum(cost_cents)` picks
			// it up as cash spend.
			{
				id: randomUUID(),
				contractorId: ids.electric,
				status: 'completed' as const,
				summary: 'Trace and repair the dead outlets along the north wall',
				scheduledFor: new Date(now.getTime() - 30 * day),
				completedAt: new Date(now.getTime() - 30 * day),
				isDonated: true,
				fairValueCents: 42000,
				fairValueBasis: "Contractor's standard rate card, 4 hours at $105/hr",
				requestedByUserId: staffId
			},
			{
				id: randomUUID(),
				contractorId: ids.fire,
				status: 'completed' as const,
				summary: 'Annual extinguisher inspection and recharge',
				scheduledFor: new Date(now.getTime() - 40 * day),
				completedAt: new Date(now.getTime() - 40 * day),
				costCents: 18000,
				invoiceRef: 'CFS-9903',
				requestedByUserId: staffId
			},
			// Booked, not yet due — the ordinary open job.
			{
				id: randomUUID(),
				contractorId: ids.plumb,
				status: 'scheduled' as const,
				summary: 'Green room sink is backing up',
				scheduledFor: new Date(now.getTime() + 4 * day),
				expectedBackAt: new Date(now.getTime() + 4 * day),
				quotedCents: 25000,
				requestedByUserId: staffId
			},
			// Nobody has been called yet.
			{
				id: randomUUID(),
				contractorId: ids.handy,
				status: 'draft' as const,
				summary: 'Rehang the practice room door — hinges pulling out of the frame',
				requestedByUserId: staffId,
				notes: 'Reported at the last work party.'
			},
			// Called off, and deliberately with no completion: the amp it was for
			// is still in the shop under the job above.
			{
				id: randomUUID(),
				contractorId: ids.hvac,
				status: 'cancelled' as const,
				summary: 'Service the rooftop unit before summer',
				scheduledFor: new Date(now.getTime() - 30 * day),
				quotedCents: 45000,
				requestedByUserId: staffId,
				notes: 'Cancelled — their certificate of insurance had lapsed.'
			},
			// Against the archived tuner, proving history survives archiving.
			{
				id: randomUUID(),
				contractorId: ids.piano,
				status: 'completed' as const,
				summary: 'Tune the upright',
				scheduledFor: new Date(now.getTime() - 200 * day),
				completedAt: new Date(now.getTime() - 200 * day),
				costCents: 15000,
				requestedByUserId: staffId
			}
		],
		4
	);

	return { contractors: contractors.length, jobs: jobs.length };
}
