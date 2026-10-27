import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { query, getRequestEvent } from '$app/server';
import { form } from './_remote';
import { requireUser } from '$lib/server/authorization';
import { getById } from '$lib/server/event/event-service';
import {
	cancelRsvp,
	createRsvp,
	getUserRsvp,
	listRsvpsForEvent
} from '$lib/server/event/rsvp-service';
import { rsvpClosedReason, type RsvpClosedReason } from '$lib/server/event/rsvp-availability';
import { requireListingWriter } from '$lib/server/event/listing-guard';
import { toMemberRef } from '$lib/server/entity/refs';
import type { RosterRow } from '$lib/types/roster';
import { getPublicEventDetail } from '$lib/remote/events.remote';

/**
 * The viewer's RSVP, for the public event page's control (#1995). It answers
 * every visitor: signed out is a state, not an error, because the control
 * renders the sign-in interrupt for it (#1999). Writes are the forms below.
 */

export type RsvpState = 'closed' | 'signed-out' | 'open' | 'going';

export interface RsvpStatus {
	state: RsvpState;
	reason: RsvpClosedReason | null;
	/** What the confirm button will record, so the member sees it first. */
	attendee: { name: string; email: string } | null;
}

export const getRsvpStatus = query(z.string().min(1), async (id): Promise<RsvpStatus> => {
	const { locals } = getRequestEvent();
	const evt = await getById(id);
	if (!evt) error(404, 'Event not found');

	const reason = rsvpClosedReason(evt);
	const user = locals.user ?? null;
	const mine = user && !reason ? await getUserRsvp(evt.id, user.id) : null;
	const state: RsvpState = reason ? 'closed' : !user ? 'signed-out' : mine ? 'going' : 'open';
	return { state, reason, attendee: user ? { name: user.name, email: user.email } : null };
});

const closedMessages: Record<RsvpClosedReason, string> = {
	unpublished: 'This event is not open for RSVPs yet',
	cancelled: 'This event was cancelled',
	past: 'This event has already happened',
	ticketed: 'This event uses tickets, not RSVPs'
};

// The headcount on the event page moves with the RSVP.
function refreshEventPage(eventId: string) {
	void getRsvpStatus(eventId).refresh();
	void getPublicEventDetail(eventId).refresh();
}

export const confirmRsvp = form(z.object({ eventId: z.string().min(1) }), async (data) => {
	const user = requireUser();
	const evt = await getById(data.eventId);
	if (!evt) error(404, 'Event not found');
	const reason = rsvpClosedReason(evt);
	if (reason) error(409, closedMessages[reason]);

	await createRsvp({
		eventId: evt.id,
		userId: user.id,
		attendeeName: user.name,
		attendeeEmail: user.email
	});
	refreshEventPage(evt.id);
	return { success: true };
});

export const withdrawRsvp = form(z.object({ eventId: z.string().min(1) }), async (data) => {
	const user = requireUser();
	await cancelRsvp(data.eventId, user.id);
	refreshEventPage(data.eventId);
	return { success: true };
});

/**
 * Who RSVP'd, for the staff listing page. Contact data, so it takes the
 * listing's write guard rather than the page's `event.read`. A staffer the
 * guard refuses gets null, so the card hides instead of failing the page.
 */
export const getEventRsvpRoster = query(
	z.string().min(1),
	async (eventId): Promise<{ total: number; rows: RosterRow[] } | null> => {
		try {
			await requireListingWriter(eventId);
		} catch (err) {
			if ((err as { status?: number }).status === 403) return null;
			throw err;
		}
		const rows = await listRsvpsForEvent(eventId);
		return {
			total: rows.length,
			rows: rows.map((r) => ({
				id: r.id,
				person: toMemberRef({ id: r.userId, name: r.name, email: r.email }),
				contact: r.email,
				at: r.createdAt
			}))
		};
	}
);
