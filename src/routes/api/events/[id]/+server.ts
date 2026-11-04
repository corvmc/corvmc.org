import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getById } from '#lib/server/event/event-service.js';
import { publicEventStatuses } from '#lib/server/db/schema/event.js';
import { getTicketsRemaining } from '#lib/server/ticket/ticket-service.js';
import { resolveImageUrl } from '#lib/server/storage.js';
import { getSubscription } from '#lib/server/finance/subscription-service.js';

export const GET: RequestHandler = async ({ params, locals }) => {
	const evt = await getById(params.id);
	if (!evt) throw error(404, 'Event not found');
	// Matches getPublicEventDetail: cancelled events stay readable so this
	// endpoint doesn't disagree with the page it backs.
	if (!(publicEventStatuses as readonly string[]).includes(evt.status)) {
		throw error(404, 'Event not found');
	}

	const posterUrl = resolveImageUrl(evt.posterKey);

	let remaining: number | null = null;
	if (evt.ticketingEnabled) {
		remaining = await getTicketsRemaining(params.id);
	}

	let isSustainingMember = false;
	if (locals.user?.stripeId) {
		const sub = await getSubscription(locals.user.stripeId);
		isSustainingMember = sub !== null;
	}

	return json({
		event: {
			id: evt.id,
			title: evt.title,
			description: evt.description,
			status: evt.status,
			source: evt.source,
			startsAt: evt.startsAt.toISOString(),
			endsAt: evt.endsAt?.toISOString() ?? null,
			doorsAt: evt.doorsAt?.toISOString() ?? null,
			tags: evt.tags,
			posterUrl,
			ticketingEnabled: evt.ticketingEnabled,
			ticketPrice: evt.ticketPrice,
			ticketQuantity: evt.ticketQuantity
		},
		remaining,
		isSustainingMember
	});
};
