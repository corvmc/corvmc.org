import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import { openSourcedTask } from '#lib/server/task/sourced-tasks.js';
import { formatCents } from '#lib/utils/format.js';

/**
 * A door card payment charged with nothing to match it opens one task (#2757):
 * a staffer attaches it or refunds it in Stripe, which the app cannot see, so
 * the task is closed by hand and never opened again for that payment. Opening
 * it touches no money; a failure is logged, and the sweep carries on.
 */
export async function openUnmatchedPaymentTask(input: {
	paymentIntentId: string;
	kind: 'sale' | 'gift';
	amountCents: number;
	eventId?: string | null;
}): Promise<void> {
	try {
		const eventId = input.eventId ? await existingEvent(input.eventId) : null;
		const what = input.kind === 'sale' ? 'door card sale' : 'door card gift';
		await openSourcedTask({
			source: 'door_payment',
			sourceId: input.paymentIntentId,
			once: true,
			title: `Attach or refund a ${what} of ${formatCents(input.amountCents)}`,
			notes: `Stripe payment ${input.paymentIntentId} was charged with no ${
				input.kind === 'sale' ? 'tickets' : 'gift record'
			} to match.`,
			eventId
		});
	} catch (err) {
		console.error(`[door] task for unmatched ${input.paymentIntentId} failed:`, err);
	}
}

async function existingEvent(id: string): Promise<string | null> {
	const [row] = await db
		.select({ id: eventListing.id })
		.from(eventListing)
		.where(eq(eventListing.id, id))
		.limit(1);
	return row?.id ?? null;
}
