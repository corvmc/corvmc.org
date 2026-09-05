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
	const { handleAudioCheckout } = await import('$lib/server/audio/checkout-listener');

	domainEvents.on('checkout.completed', async ({ data: event }) => {
		await handleReservationCheckout(event.stripeSession);
	});

	domainEvents.on('checkout.completed', async ({ data: event }) => {
		await handleTicketCheckout(event.stripeSession);
	});

	domainEvents.on('checkout.completed', async ({ data: event }) => {
		await handleBandPremiumCheckout(event.stripeSession);
	});

	domainEvents.on('checkout.completed', async ({ data: event }) => {
		await handleAudioCheckout(event.stripeSession);
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
	const { listUsersWithCapability } = await import('$lib/server/authorization');

	domainEvents.on('inbox.message_received', async ({ data: event }) => {
		// A band's booking enquiry goes to the act, not to us. Same handler because
		// it is the same signal — and this is the one path that covers both ways a
		// message arrives, the form and the booker's reply routed back in by
		// Postmark.
		if (event.channel === 'band') {
			await notifyBandOfEnquiry(event);
			return;
		}

		// Member↔member conversations are not staff's business, and this event
		// carries `preview` — the first 200 characters of the message. Without
		// this line, every private message would put its opening words in every
		// staff member's notification bell. The same is true of a band thread
		// above, for the same reason and a different owner.
		if (event.channel === 'direct') return;

		// Whoever can read the inbox — the people for whom a new message is work.
		const staffUsers = await listUsersWithCapability('inbox.read');
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

	/**
	 * Tell a band's owner and admins that somebody wrote to them.
	 *
	 * The enquiry itself is *not* delivered by email any more — it lives on the
	 * thread, and the notification is a pointer to it. That is what makes a
	 * reply possible at all: an emailed enquiry could only ever be answered from
	 * a personal mailbox, off the record and with the act's own address on it.
	 *
	 * `preview` is carried here, unlike on the direct channel, because these
	 * recipients are the intended readers rather than an audience the message was
	 * never addressed to.
	 */
	async function notifyBandOfEnquiry(event: {
		threadId: string;
		contactName: string | null;
		preview: string;
	}): Promise<void> {
		const { bandOfThread } = await import('$lib/server/inbox/band-service');
		const { getById, listBandAdmins } = await import('$lib/server/band/band-service');
		const { env } = await import('$env/dynamic/private');

		const groupId = await bandOfThread(event.threadId);
		if (!groupId) return;

		const [band, admins] = await Promise.all([getById(groupId), listBandAdmins(groupId)]);
		if (!band || admins.length === 0) return;

		const siteUrl = env.PUBLIC_SITE_URL ?? 'https://corvmc.org';
		const href = `/band/${band.slug}/messages/${event.threadId}`;
		const from = event.contactName ?? 'Someone';

		for (const admin of admins) {
			try {
				await dispatch({
					type: 'band_enquiry_received',
					userId: admin.userId,
					userEmail: admin.userEmail,
					title: `${from} contacted ${band.name}`,
					body: event.preview,
					href,
					emailTemplate: {
						alias: 'notification',
						model: {
							subject: `New booking enquiry — ${band.name}`,
							heading: 'New enquiry',
							greeting: `Hi ${admin.userName},`,
							paragraphs: [
								{ text: `${from} used the booking form on ${band.name}'s public page.` }
							],
							quote: event.preview,
							cta: { url: `${siteUrl}${href}`, label: 'Read and reply' },
							footnote:
								'Reply on the site — it reaches them by email, and neither of you sees the other’s address.'
						}
					}
				});
			} catch (err) {
				console.error(`[inbox] Failed to notify band admin ${admin.userEmail}:`, err);
			}
		}
	}

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
		// `expireWaitlisted()` promotes the next member itself, before it emits
		// this — it returns the count. Promoting again here would not find that
		// member (they now have `waitlistNotifiedAt`) but the one behind them,
		// and hand the same slot to two people.
		if (event.cause === 'waitlist_expired') return;

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
