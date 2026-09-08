import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { query, form } from '$app/server';
import { requireCapability } from '$lib/server/authorization';
import { mapDomainError } from '$lib/server/errors';
import {
	createVenue as createService,
	updateVenue as updateService,
	setPrimaryVenue as setPrimaryService,
	archiveVenue as archiveService,
	restoreVenue as restoreService,
	deleteVenue as deleteService,
	getVenue as getService,
	listVenues
} from '$lib/server/venue/venue-service';

/**
 * Venues are guarded as events, not on a `venue.*` set of their own.
 *
 * A venue is a fact about where a show is, and the person who decides that is
 * the person who manages the show — there is no job at CMC that curates rooms
 * and does not produce in them. A capability exists when a guard names it, and
 * naming one here would have meant a resource whose only reason to exist was
 * symmetry with the other tables' remotes.
 */

const venueFields = {
	name: z.string().min(1, 'Name is required').max(120),
	address1: z.string().max(200).optional(),
	city: z.string().max(100).optional(),
	state: z.string().max(50).optional(),
	postalCode: z.string().max(20).optional(),
	// A cleared number field is dropped from the payload rather than arriving
	// null, so this has to tolerate absence and an empty string alike.
	capacity: z.string().optional(),
	contactName: z.string().max(120).optional(),
	contactEmail: z.string().max(200).optional(),
	contactPhone: z.string().max(50).optional(),
	loadInNotes: z.string().max(2000).optional(),
	notes: z.string().max(2000).optional()
};

function venueInput(data: Record<string, string | undefined>) {
	const capacity =
		data.capacity && data.capacity.trim() !== '' ? parseInt(data.capacity, 10) : null;

	return {
		name: data.name!,
		address1: data.address1 || null,
		city: data.city || null,
		state: data.state || null,
		postalCode: data.postalCode || null,
		capacity: Number.isFinite(capacity as number) ? capacity : null,
		contactName: data.contactName || null,
		contactEmail: data.contactEmail || null,
		contactPhone: data.contactPhone || null,
		loadInNotes: data.loadInNotes || null,
		notes: data.notes || null
	};
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const getVenues = query(
	z.object({ includeArchived: z.boolean().optional() }).optional(),
	async (filters) => {
		await requireCapability('event.read');
		return listVenues({ includeArchived: filters?.includeArchived ?? false });
	}
);

/** The picker on the event create form and the event edit form. Live rooms only. */
export const getVenueOptions = query(async () => {
	await requireCapability('event.read');
	const rows = await listVenues();
	return rows.map((v) => ({ id: v.id, name: v.name, isPrimary: v.isPrimary }));
});

export const getVenueDetail = query(z.string(), async (id) => {
	await requireCapability('event.read');
	try {
		return await getService(id);
	} catch {
		error(404, 'Venue not found');
	}
});

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export const createVenue = form(z.object(venueFields), async (data) => {
	await requireCapability('event.manage');
	try {
		const row = await createService(venueInput(data));
		await getVenues().refresh();
		await getVenueOptions().refresh();
		return { id: row.id };
	} catch (err) {
		mapDomainError(err);
	}
});

export const updateVenue = form(
	z.object({ id: z.string().min(1), ...venueFields }),
	async (data) => {
		await requireCapability('event.manage');
		try {
			await updateService(data.id, venueInput(data));
			await Promise.all([
				getVenues().refresh(),
				getVenueOptions().refresh(),
				getVenueDetail(data.id).refresh()
			]);
			return { success: true };
		} catch (err) {
			mapDomainError(err);
		}
	}
);

/** Which room is ours. Exactly one, and moving it is one act. */
export const setPrimaryVenue = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireCapability('event.manage');
	try {
		await setPrimaryService(data.id);
		await Promise.all([
			getVenues().refresh(),
			getVenueOptions().refresh(),
			getVenueDetail(data.id).refresh()
		]);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

export const archiveVenue = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireCapability('event.manage');
	try {
		await archiveService(data.id);
		await Promise.all([
			getVenues().refresh(),
			getVenueOptions().refresh(),
			getVenueDetail(data.id).refresh()
		]);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

export const restoreVenue = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireCapability('event.manage');
	try {
		await restoreService(data.id);
		await Promise.all([
			getVenues().refresh(),
			getVenueOptions().refresh(),
			getVenueDetail(data.id).refresh()
		]);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});

export const deleteVenue = form(z.object({ id: z.string().min(1) }), async (data) => {
	await requireCapability('event.manage');
	try {
		await deleteService(data.id);
		await Promise.all([getVenues().refresh(), getVenueOptions().refresh()]);
		return { success: true };
	} catch (err) {
		mapDomainError(err);
	}
});
