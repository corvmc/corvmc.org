import { error } from '@sveltejs/kit';
import { query } from '$app/server';
import { z } from 'zod';
import { command, form } from './_remote';
import { requireCapability } from '$lib/server/authorization';
import { mintConnectionToken } from '$lib/server/finance/terminal-service';
import { paymentDriver } from '$lib/server/stripe';
import { completeFakeTerminalPayment } from '$lib/server/finance/gateway/fake-gateway';
import {
	cancelDoorSale as cancelDoorSaleService,
	fulfillDoorSale,
	getDoorSale as getDoorSaleService,
	listDoorEvents,
	startDoorSale as startDoorSaleService
} from '$lib/server/ticket/door-sale';

/**
 * A Stripe Terminal connection token for the door phone (#612).
 *
 * A `command`, not a `query`: the token is single-use, so a cached or
 * deduplicated read would hand the SDK one it has already spent. The plugin
 * asks through `RequestedConnectionToken` and gets this via `setConnectionToken`.
 */
export const getTerminalConnection = command(async () => {
	await requireCapability('finance.collect');
	return mintConnectionToken();
});

/** Tonight's collective-sold shows, and whether this environment can fake a tap. */
export const getDoorEvents = query(async () => {
	await requireCapability('finance.collect');
	return { events: await listDoorEvents(), canSimulate: paymentDriver() === 'fake' };
});

/** The seller is the signed-in staffer; nothing the client sends can name another. */
export const startDoorSale = form(
	z.object({
		eventId: z.string().min(1),
		quantity: z.number().int().min(1).max(20),
		// An emptied price box submits nothing, and nothing at the door is free.
		unitPriceCents: z.number().int().min(0).max(100_000).optional()
	}),
	async ({ eventId, quantity, unitPriceCents = 0 }) => {
		const staff = await requireCapability('finance.collect');
		return startDoorSaleService({ eventId, quantity, unitPriceCents, staffUserId: staff.id });
	}
);

/** Polled after a tap until the webhook has checked the order in. */
export const getDoorSale = query(z.string().min(1), async (paymentIntentId) => {
	await requireCapability('finance.collect');
	return getDoorSaleService(paymentIntentId);
});

export const cancelDoorSale = command(z.string().min(1), async (paymentIntentId) => {
	await requireCapability('finance.collect');
	await cancelDoorSaleService(paymentIntentId);
});

/**
 * The tap, without a phone: only under the fake driver, where there is no
 * webhook to wait for. It goes through `fulfillDoorSale`, as a real tap does.
 */
export const simulateDoorTap = command(z.string().min(1), async (paymentIntentId) => {
	await requireCapability('finance.collect');
	if (paymentDriver() !== 'fake') error(404, 'Not found');
	await fulfillDoorSale(completeFakeTerminalPayment(paymentIntentId));
});
