import { error } from '@sveltejs/kit';
import { query } from '$app/server';
import { z } from 'zod';
import { command, form } from './_remote';
import { can, requireCapability, requireUser } from '#lib/server/authorization.js';
import { mintConnectionToken } from '#lib/server/finance/terminal-service.js';
import { paymentDriver } from '#lib/server/stripe.js';
import { completeFakeTerminalPayment } from '#lib/server/finance/gateway/fake-gateway.js';
import {
	cancelDoorSale as cancelDoorSaleService,
	doorSaleEventId,
	fulfillDoorSale,
	getDoorSale as getDoorSaleService,
	listDoorEvents,
	startDoorSale as startDoorSaleService
} from '#lib/server/ticket/door-sale.js';
import {
	cancelDoorDonation,
	doorDonationEventId,
	fulfillDoorDonation,
	getDoorDonation,
	startDoorDonation as startDoorDonationService
} from '#lib/server/finance/door-donation.js';
import { TICKET_MIN_CHARGE_CENTS } from '#lib/config.js';

/**
 * Every door remote names the show it acts on. Staff hold `finance.collect`
 * everywhere; a confirmed door volunteer holds it for their own show during
 * the shift, through the role grant (#1630).
 */
const requireDoorSeller = (eventId: string) => requireCapability('finance.collect', { eventId });

/**
 * A sale's show comes from its tickets or its donation row, never from the
 * client. `donation` says which, so one set of remotes serves both.
 */
async function requireSellerOfSale(paymentIntentId: string) {
	requireUser();
	const ticketEventId = await doorSaleEventId(paymentIntentId);
	const eventId = ticketEventId ?? (await doorDonationEventId(paymentIntentId));
	if (!eventId) error(403, 'Not permitted');
	await requireDoorSeller(eventId);
	return { donation: ticketEventId === null };
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

/** A gift at the door (#2548): one amount, no tickets. Card only, as tickets are. */
export const startDoorDonation = form(
	z.object({
		eventId: z.string().min(1),
		amountCents: z.number().int().min(TICKET_MIN_CHARGE_CENTS).max(1_000_000)
	}),
	async ({ eventId, amountCents }) => {
		const seller = await requireDoorSeller(eventId);
		return startDoorDonationService({ eventId, amountCents, staffUserId: seller.id });
	}
);

/** Polled after a tap until the webhook has recorded the sale or the gift. */
export const getDoorSale = query(z.string().min(1), async (paymentIntentId) => {
	const { donation } = await requireSellerOfSale(paymentIntentId);
	if (donation) {
		const gift = await getDoorDonation(paymentIntentId);
		return { status: gift?.status ?? 'cancelled', quantity: 0, donationCents: gift?.amountCents };
	}
	return { ...(await getDoorSaleService(paymentIntentId)), donationCents: undefined };
});

export const cancelDoorSale = command(z.string().min(1), async (paymentIntentId) => {
	const { donation } = await requireSellerOfSale(paymentIntentId);
	if (donation) await cancelDoorDonation(paymentIntentId);
	else await cancelDoorSaleService(paymentIntentId);
});

/**
 * The tap, without a phone: only under the fake driver, where there is no
 * webhook to wait for. It goes through `fulfillDoorSale`, as a real tap does.
 */
export const simulateDoorTap = command(z.string().min(1), async (paymentIntentId) => {
	const { donation } = await requireSellerOfSale(paymentIntentId);
	if (paymentDriver() !== 'fake') error(404, 'Not found');
	const intent = completeFakeTerminalPayment(paymentIntentId);
	await (donation ? fulfillDoorDonation(intent) : fulfillDoorSale(intent));
});
