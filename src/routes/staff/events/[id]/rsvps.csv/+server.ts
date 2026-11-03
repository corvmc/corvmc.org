import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireListingWriter } from '#lib/server/event/listing-guard.js';
import { getById } from '#lib/server/event/event-service.js';
import { listRsvpRoster } from '#lib/server/event/rsvp-service.js';
import { rosterCsv } from '#lib/server/roster/roster.js';
import { csvResponse } from '#lib/server/report/csv.js';

/**
 * An event's RSVPs as CSV. A `+server.ts` because a download needs a
 * `Content-Disposition` header, so the guard is here rather than at a remote:
 * the same `requireListingWriter` the RSVP card's query takes, first.
 */
export const GET: RequestHandler = async ({ params }) => {
	await requireListingWriter(params.id);
	const evt = await getById(params.id);
	if (!evt) error(404, 'Event not found');

	const csv = rosterCsv(await listRsvpRoster(evt.id), [
		{ header: 'rsvped_at', value: (r) => r.rsvpedAt.toISOString() }
	]);
	const slug = evt.title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	return csvResponse(`rsvps_${slug || evt.id}.csv`, csv);
};
