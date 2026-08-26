import { domainEvents } from './event-bus';

// ---------------------------------------------------------------------------
// Listener registration
// ---------------------------------------------------------------------------
// Called once at server startup (from hooks.server.ts). Registers all
// domain event listeners — checkout fulfillment, notification dispatch, etc.
//
// Each listener module exports a setup function that subscribes to the
// events it cares about. Import order doesn't matter since emittery
// supports multiple listeners per event.
// ---------------------------------------------------------------------------

let registered = false;

export function registerListeners(): void {
	if (registered) return;
	registered = true;

	// --- Checkout fulfillment (migrated from callback pattern) ---
	registerCheckoutListeners();

	// --- Notification dispatch ---
	registerNotificationListeners();

	// --- Inbox message → staff notification ---
	registerInboxListeners();

	// --- Waitlist promotion on cancellation ---
	registerWaitlistListeners();
}

// ---------------------------------------------------------------------------
// Checkout fulfillment listeners
// ---------------------------------------------------------------------------
// These replace the old onCheckoutComplete() callback registry.
// Each module checks session metadata to decide whether to act.
// ---------------------------------------------------------------------------

async function registerCheckoutListeners(): Promise<void> {
	const { handleReservationCheckout } = await import('$lib/server/reservation/checkout-listener');
	const { handleTicketCheckout } = await import('$lib/server/ticket/checkout-listener');
	const { handleBandPremiumCheckout } = await import('$lib/server/band/band-checkout-listener');

	domainEvents.on('checkout.completed', async ({ data: event }) => {
		await handleReservationCheckout(event.stripeSession);
	});

	domainEvents.on('checkout.completed', async ({ data: event }) => {
		await handleTicketCheckout(event.stripeSession);
	});

	domainEvents.on('checkout.completed', async ({ data: event }) => {
		await handleBandPremiumCheckout(event.stripeSession);
	});
}

// ---------------------------------------------------------------------------
// Notification listeners
// ---------------------------------------------------------------------------
// Imported from the notification module. Wires domain events to the
// notification dispatcher which handles preference checks and channel routing.
// ---------------------------------------------------------------------------

async function registerNotificationListeners(): Promise<void> {
	const { registerAllNotificationListeners } =
		await import('$lib/server/notification/notification-listeners');
	registerAllNotificationListeners();
}

// ---------------------------------------------------------------------------
// Inbox listeners
// ---------------------------------------------------------------------------
// Inbound messages notify staff. Outbound messages on the portal channel notify
// the member who is waiting on them — every other channel delivers the reply
// itself (email, SMS, Meta), so there is nothing to tell them about.
// ---------------------------------------------------------------------------

async function registerInboxListeners(): Promise<void> {
	const { dispatch } = await import('$lib/server/notification/dispatcher');
	const { listStaffUsers } = await import('$lib/server/authorization');

	domainEvents.on('inbox.message_received', async ({ data: event }) => {
		// Member↔member conversations are not staff's business, and this event
		// carries `preview` — the first 200 characters of the message. Without
		// this line, every private message would put its opening words in every
		// staff member's notification bell.
		if (event.channel === 'direct') return;

		const staffUsers = await listStaffUsers();
		const contactLabel = event.contactName ?? 'Someone';

		for (const staff of staffUsers) {
			try {
				await dispatch({
					type: 'inbox_message_received',
					userId: staff.id,
					userEmail: staff.email,
					title: `New message from ${contactLabel}`,
					body: event.preview,
					href: `/staff/inbox/${event.threadId}`
				});
			} catch (err) {
				console.error(`[inbox] Failed to notify staff ${staff.email}:`, err);
			}
		}
	});

	domainEvents.on('inbox.message_sent', async ({ data: event }) => {
		if (event.channel !== 'portal') return;

		// The event carries only ids. Everything the notification needs — the
		// subject, and the preview that addOutboundMessage just set to this
		// reply's opening line — is on the thread row.
		const { findThreadById } = await import('$lib/server/inbox/thread-service');
		const { listThreadParticipants } = await import('$lib/server/inbox/portal-service');
		const { db } = await import('$lib/server/db');
		const { user } = await import('$lib/server/db/schema/authentication');
		const { inArray } = await import('drizzle-orm');
		const { env } = await import('$env/dynamic/private');

		const thread = await findThreadById(event.threadId);
		if (!thread) return;

		const participants = await listThreadParticipants(event.threadId);
		const recipientIds = participants.map((p) => p.userId);
		if (recipientIds.length === 0) return;

		const recipients = await db
			.select({ id: user.id, name: user.name, email: user.email })
			.from(user)
			.where(inArray(user.id, recipientIds));

		const siteUrl = env.PUBLIC_SITE_URL ?? 'https://corvmc.org';
		const url = `${siteUrl}/member/messages/${event.threadId}`;
		const subject = thread.subject ?? 'your message';

		for (const recipient of recipients) {
			try {
				await dispatch({
					type: 'portal_message_reply',
					userId: recipient.id,
					userEmail: recipient.email,
					title: `CorvMC replied to "${subject}"`,
					body: thread.preview ?? undefined,
					href: `/member/messages/${event.threadId}`,
					emailTemplate: {
						alias: 'notification',
						model: {
							subject: `Re: ${subject}`,
							preview_text: thread.preview ?? 'You have a new reply.',
							heading: 'New reply',
							greeting: `Hi ${recipient.name},`,
							paragraphs: [{ text: 'A staff member replied to your conversation with CorvMC.' }],
							// Raw — the dispatcher escapes it and preserves the line breaks.
							quote: thread.preview ?? '',
							cta: { url, label: 'View Conversation' }
						}
					}
				});
			} catch (err) {
				console.error(`[inbox] Failed to notify member ${recipient.email}:`, err);
			}
		}
	});
}

// ---------------------------------------------------------------------------
// Waitlist listeners
// ---------------------------------------------------------------------------
// When a reservation is cancelled, check if any waitlisted reservations
// can be promoted to fill the freed slot.
// ---------------------------------------------------------------------------

async function registerWaitlistListeners(): Promise<void> {
	const { promoteNextWaitlisted } = await import('$lib/server/reservation/waitlist-service');

	domainEvents.on('reservation.cancelled', async ({ data: event }) => {
		// Parse the original reservation's time range to find waitlisted candidates
		// We need the raw Date objects — reconstruct from the formatted strings
		// by looking up the cancelled reservation directly
		const { db } = await import('$lib/server/db');
		const { reservation } = await import('$lib/server/db/schema/reservation');
		const { eq } = await import('drizzle-orm');

		const [row] = await db
			.select({ startsAt: reservation.startsAt, endsAt: reservation.endsAt })
			.from(reservation)
			.where(eq(reservation.id, event.reservationId))
			.limit(1);

		if (row) {
			await promoteNextWaitlisted(row.startsAt, row.endsAt);
		}
	});
}
