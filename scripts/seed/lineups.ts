import { directoryEntry } from '../../src/lib/server/db/schema/directory';
import { eventBand } from '../../src/lib/server/db/schema/event';
import { db } from './db';
import { SUPPORT_BAND_NAMES } from './pools';
import { pickN, randomInt } from './util';
import { inArray } from 'drizzle-orm';

/**
 * Write an event's bill: the owner confirmed at the top, then a mix of the
 * three states a support slot can be in, so every render path has data —
 * plain-text credits, an invitation waiting in a band's inbox, and a decline.
 */
export async function seedLineup(
	eventId: string,
	owner: { id: string; name: string } | null,
	support: { name: string; bandId?: string; status?: string }[]
) {
	// A credit names a `directory_entry`, so the group ids these fixtures carry
	// have to be resolved. One query for the whole bill.
	//
	// This works only because `seedDirectoryEntries()` now runs *before* anything
	// that writes a credit. It used to run last, and resolving here silently
	// wrote nulls into every row.
	const groupIds = [owner?.id, ...support.map((sup) => sup.bandId)].filter(
		(id): id is string => !!id
	);
	const entryRows = groupIds.length
		? await db
				.select({ groupId: directoryEntry.groupId, id: directoryEntry.id })
				.from(directoryEntry)
				.where(inArray(directoryEntry.groupId, groupIds))
		: [];
	const entryFor = new Map(
		entryRows.filter((r) => r.groupId).map((r) => [r.groupId as string, r.id])
	);

	const rows: any[] = [];
	if (owner) {
		rows.push({
			eventId,
			name: owner.name,
			directoryEntryId: entryFor.get(owner.id) ?? null,
			billingOrder: 0,
			status: 'confirmed',
			addedByGroupId: owner.id
		});
	}
	support.forEach((sup, i) => {
		rows.push({
			eventId,
			name: sup.name,
			directoryEntryId: sup.bandId ? (entryFor.get(sup.bandId) ?? null) : null,
			billingOrder: rows.length + i,
			status: sup.status ?? (sup.bandId ? 'pending' : 'unlinked'),
			addedByGroupId: owner?.id ?? null
		});
	});
	if (rows.length === 0) return;
	// D1 caps a statement at 100 bound params.
	for (let i = 0; i < rows.length; i += 12) {
		await db.insert(eventBand).values(rows.slice(i, i + 12));
	}
}

/**
 * Band-booked practice slots. Seeded separately from `seedReservations` because
 * bands do not exist yet at that point, and without these rows the staff
 * reservation queue has no band bookings to render, search or filter.
 */
/**
 * Credit member bands on a few CMC-produced shows.
 *
 * These have no owning group — `event.groupId` stays null, staff run the night —
 * but the bands genuinely played, so the bill is pure attribution. Staff-set
 * slots land confirmed: staff booked the show, the band already agreed.
 */
export async function seedCmcEventLineups(events: any[], bands: any[]) {
	const liveBands = bands.filter((b: any) => !b.deletedAt).slice(0, 4);
	if (liveBands.length === 0) return;

	const published = events.filter((e: any) => e.status === 'published').slice(0, 5);
	for (const [i, evt] of published.entries()) {
		const headliner = liveBands[i % liveBands.length];
		await seedLineup(evt.id, null, [
			{ name: headliner.name, bandId: headliner.id, status: 'confirmed' },
			...pickN(SUPPORT_BAND_NAMES, randomInt(0, 2)).map((name) => ({ name }))
		]);
	}
}
