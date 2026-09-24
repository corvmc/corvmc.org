import { z } from 'zod';
import { error, invalid } from '@sveltejs/kit';
import { query } from '$app/server';
import { form } from './_remote';
import { requireGroupRole } from '$lib/server/group/group-context';
import { mapDomainError } from '$lib/server/errors';
import { getById, openBandTicketSale, closeBandTicketSale } from '$lib/server/event/event-service';
import { bandSaleBlocker } from '$lib/server/ticket/ticket-seller';
import {
	checkIn,
	getEventTickets,
	getTicketById,
	getTicketsSold
} from '$lib/server/ticket/ticket-service';
import { dollarsToCents } from '$lib/utils/event-ticketing';

/**
 * A band selling its own gig through the collective (#1203).
 *
 * Admin-only on the band the caller names: the guard resolves the band from
 * the slug and checks the caller's role there, and every service call takes
 * that band's id, never one the client sent.
 */

const ref = z.object({ slug: z.string().min(1), eventId: z.string().min(1) });

/** The gig's sale as its band sees it, including why it cannot sell yet. */
export const getBandTicketSale = query(ref, async ({ slug, eventId }) => {
	const { group: band } = await requireGroupRole({ slug }, 'admin');
	const evt = await getById(eventId);
	if (!evt || evt.groupId !== band.id) throw error(404, 'Event not found');

	const [blocker, sold] = await Promise.all([
		bandSaleBlocker(band.id),
		evt.ticketingEnabled ? getTicketsSold(eventId) : Promise.resolve(0)
	]);
	return {
		onSale: evt.ticketingEnabled,
		blocker,
		priceCents: evt.ticketPrice,
		priceFloorCents: evt.ticketPriceFloorCents,
		quantity: evt.ticketQuantity,
		sold
	};
});

/** A typed `0` is a real floor here: it runs the scale to free. */
function floorToCents(input: string | undefined): number | undefined {
	const raw = (input ?? '').trim().replace(/^\$/, '');
	if (raw === '' || Number(raw) === 0) return 0;
	return dollarsToCents(raw) ?? undefined;
}

export const openBandTicketSaleForm = form(
	ref.extend({
		priceDollars: z.string().max(12),
		floorDollars: z.string().max(12).optional(),
		quantity: z.string().max(6).optional()
	}),
	async (data, issue) => {
		const { group: band } = await requireGroupRole({ slug: data.slug }, 'admin');

		const priceCents = dollarsToCents(data.priceDollars);
		if (!priceCents) invalid(issue.priceDollars('Enter a ticket price like 12.00'));
		const priceFloorCents = floorToCents(data.floorDollars);
		if (priceFloorCents === undefined) {
			invalid(issue.floorDollars('Enter the least someone may pay, or 0'));
		}
		const rawQuantity = (data.quantity ?? '').trim();
		const quantity = rawQuantity === '' ? null : Number(rawQuantity);
		if (quantity !== null && (!Number.isInteger(quantity) || quantity < 1)) {
			invalid(issue.quantity('Capacity is a whole number of tickets, or blank for no limit'));
		}

		try {
			await openBandTicketSale(data.eventId, band.id, {
				priceCents: priceCents!,
				priceFloorCents: priceFloorCents!,
				quantity
			});
		} catch (err) {
			mapDomainError(err);
		}
		return { success: true };
	}
);

export const closeBandTicketSaleForm = form(ref, async ({ slug, eventId }) => {
	const { group: band } = await requireGroupRole({ slug }, 'admin');
	try {
		await closeBandTicketSale(eventId, band.id);
	} catch (err) {
		mapDomainError(err);
	}
	return { success: true };
});

/** The band admin's gig, or 404: another band's gig is a wrong address. */
async function requireOwnGig(slug: string, eventId: string) {
	const ctx = await requireGroupRole({ slug }, 'admin');
	const evt = await getById(eventId);
	if (!evt || evt.groupId !== ctx.group.id) throw error(404, 'Event not found');
	return ctx;
}

/**
 * The door list for the band's own gig (#1543): name and code, no email.
 * Staff keep their own door at `/staff/events/[id]/check-in`.
 */
export const getBandDoorList = query(ref, async ({ slug, eventId }) => {
	await requireOwnGig(slug, eventId);
	const live = (await getEventTickets(eventId)).filter(
		(t) => t.status === 'valid' || t.status === 'checked_in'
	);
	return {
		tickets: live.map((t) => ({
			id: t.id,
			code: t.code,
			attendeeName: t.attendeeName,
			status: t.status
		})),
		checkedIn: live.filter((t) => t.status === 'checked_in').length
	};
});

/** The staff door's `checkIn`, scoped to a ticket for this band's own gig. */
export const checkInBandTicket = form(
	ref.extend({ ticketId: z.string().min(1) }),
	async ({ slug, eventId, ticketId }) => {
		const { user } = await requireOwnGig(slug, eventId);
		const ticket = await getTicketById(ticketId);
		if (!ticket || ticket.eventId !== eventId) throw error(404, 'Ticket not found');
		try {
			const result = await checkIn(ticketId, user.id);
			return { success: true, ...result };
		} catch (err) {
			mapDomainError(err);
		}
		return { success: true };
	}
);
