import { error } from '@sveltejs/kit';
import { query } from '$app/server';
import { z } from 'zod';
import { command, form } from './_remote';
import { can, requireCapability, requireUser } from '$lib/server/authorization';
import { mintConnectionToken } from '$lib/server/finance/terminal-service';
import { paymentDriver } from '$lib/server/stripe';
import { completeFakeTerminalPayment } from '$lib/server/finance/gateway/fake-gateway';
import {
	cancelDoorSale as cancelDoorSaleService,
	doorSaleEventId,
	fulfillDoorSale,
	getDoorSale as getDoorSaleService,
	listDoorEvents,
	startDoorSale as startDoorSaleService
} from '$lib/server/ticket/door-sale';

/**
 * Every door remote names the show it acts on. Staff hold `finance.collect`
 * everywhere; a confirmed door volunteer holds it for their own show during
 * the shift, through the role grant (#1630).
 */
const requireDoorSeller = (eventId: string) => requireCapability('finance.collect', { eventId });

/** A sale's show comes from its tickets, never from the client. */
async function requireSellerOfSale(paymentIntentId: string) {
	requireUser();
	const eventId = await doorSaleEventId(paymentIntentId);
	if (!eventId) error(403, 'Not permitted');
	return requireDoorSeller(eventId);
}

/**
 * A Stripe Terminal connection token for the door phone (#612).
 *
 * A `command`, not a `query`: the token is single-use, so a cached or
 * deduplicated read would hand the SDK one it has already spent. The plugin
 * asks through `RequestedConnectionToken` and gets this via `setConnectionToken`.
 */
export const getTerminalConnection = command(z.string().min(1), async (eventId) => {
	await requireDoorSeller(eventId);
	return mintConnectionToken();
});

/** Tonight's collective-sold shows this caller may sell, and whether to fake a tap. */
export const getDoorEvents = query(async () => {
	requireUser();
	const all = await listDoorEvents();
	const events = (await can('finance.collect'))
		? all
		: (
				await Promise.all(
					all.map(async (e) => ((await can('finance.collect', { eventId: e.id })) ? e : null))
				)
			).filter((e) => e !== null);
	if (events.length === 0 && !(await can('finance.collect'))) error(403, 'Not permitted');
	return { events, canSimulate: paymentDriver() === 'fake' };
});

/** The seller is the signed-in member; nothing the client sends can name another. */
export const startDoorSale = form(
	z.object({
		eventId: z.string().min(1),
		quantity: z.number().int().min(1).max(20),
		// An emptied price box submits nothing, and nothing at the door is free.
		unitPriceCents: z.number().int().min(0).max(100_000).optional()
	}),
	async ({ eventId, quantity, unitPriceCents = 0 }) => {
		const seller = await requireDoorSeller(eventId);
		return startDoorSaleService({ eventId, quantity, unitPriceCents, staffUserId: seller.id });
	}
);

/** Polled after a tap until the webhook has checked the order in. */
export const getDoorSale = query(z.string().min(1), async (paymentIntentId) => {
	await requireSellerOfSale(paymentIntentId);
	return getDoorSaleService(paymentIntentId);
});

export const cancelDoorSale = command(z.string().min(1), async (paymentIntentId) => {
	await requireSellerOfSale(paymentIntentId);
	await cancelDoorSaleService(paymentIntentId);
});

/**
 * The tap, without a phone: only under the fake driver, where there is no
 * webhook to wait for. It goes through `fulfillDoorSale`, as a real tap does.
 */
export const simulateDoorTap = command(z.string().min(1), async (paymentIntentId) => {
	await requireSellerOfSale(paymentIntentId);
	if (paymentDriver() !== 'fake') error(404, 'Not found');
	await fulfillDoorSale(completeFakeTerminalPayment(paymentIntentId));
});
