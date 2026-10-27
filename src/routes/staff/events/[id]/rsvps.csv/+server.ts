import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireListingWriter } from '$lib/server/event/listing-guard';
import { getById } from '$lib/server/event/event-service';
import { listRsvpsForEvent } from '$lib/server/event/rsvp-service';
import { toCsv, csvResponse } from '$lib/server/report/csv';

const COLUMNS = ['name', 'email', 'rsvped_at'];

/**
 * An event's RSVPs as CSV. A `+server.ts` because a download needs a
 * `Content-Disposition` header, so the guard is here rather than at a remote:
 * the same `requireListingWriter` the RSVP card's query takes, first.
 */
export const GET: RequestHandler = async ({ params }) => {
	await requireListingWriter(params.id);
	const evt = await getById(params.id);
	if (!evt) error(404, 'Event not found');

	const rows = await listRsvpsForEvent(evt.id);
	const csv = toCsv(
		rows.map((r) => ({ name: r.name, email: r.email, rsvped_at: r.createdAt.toISOString() })),
		COLUMNS
	);
	const slug = evt.title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	return csvResponse(`rsvps_${slug || evt.id}.csv`, csv);
};
