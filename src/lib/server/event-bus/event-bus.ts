import Emittery from 'emittery';

export interface VolunteerShiftEvent {
	signupId: string;
	shiftId: string;
	userId: string;
	userName: string;
	userEmail: string;
	roleName: string;
	/** ISO strings, like every other date on this bus. */
	startsAt: string;
	endsAt: string;
}

// ---------------------------------------------------------------------------
// Domain event bus
// ---------------------------------------------------------------------------
// Single emittery instance shared across the application. All domain events
// are typed here — services emit events, and listeners (notifications,
// side effects) subscribe to them.
//
// Listeners are registered at startup in register-listeners.ts.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Event payload types
// ---------------------------------------------------------------------------

export interface CheckoutCompletedEvent {
	sessionId: string;
	metadata: Record<string, string>;
	/** Raw Stripe session for listeners that need it */
	stripeSession: import('stripe').default.Checkout.Session;
}

export interface ReservationConfirmedEvent {
	reservationId: string;
	userId: string;
	userName: string;
	userEmail: string;
	date: string;
	startTime: string;
	endTime: string;
	spaceName?: string;
}

export interface ReservationCancelledEvent {
	reservationId: string;
	userId: string;
	userName: string;
	userEmail: string;
	date: string;
	startTime: string;
	endTime: string;
	cancelledBy: 'member' | 'staff' | 'system';
}

export interface ReservationReminderDueEvent {
	reservationId: string;
	userId: string;
	userName: string;
	userEmail: string;
	date: string;
	startTime: string;
	endTime: string;
}

export interface ConfirmationReminderDueEvent {
	reservationId: string;
	userId: string;
	userName: string;
	userEmail: string;
	date: string;
	startTime: string;
	endTime: string;
}

export interface TicketPurchasedEvent {
	purchaseId: string;
	eventId: string;
	attendeeName: string;
	attendeeEmail: string;
	eventTitle: string;
	eventDate: string;
	eventTime: string;
	ticketCodes: string[];
	quantity: number;
	/** Price per ticket actually charged, after any member discount. */
	unitPriceCents: number;
	/** Tickets only: unitPriceCents × quantity. */
	subtotalCents: number;
	/** Fee-coverage line item; 0 when the buyer didn't cover fees. */
	feesCents: number;
	/** What the card was actually charged. */
	totalCents: number;
}

export interface EventCancelledEvent {
	eventId: string;
	eventTitle: string;
	eventDate: string;
	/** Ticket holders to notify */
	ticketHolders: Array<{
		attendeeName: string;
		attendeeEmail: string;
		userId?: string;
	}>;
	refundNote: string;
}

export interface BandInvitationSentEvent {
	bandId: string;
	bandName: string;
	invitedUserId: string;
	invitedUserName: string;
	invitedUserEmail: string;
	invitedByName: string;
}

export interface BandInvitationAcceptedEvent {
	bandId: string;
	bandName: string;
	acceptedByUserId: string;
	acceptedByName: string;
	/** Band owner/admins to notify */
	bandAdmins: Array<{
		userId: string;
		userName: string;
		userEmail: string;
	}>;
}

export interface ContactFormSubmittedEvent {
	threadId: string;
	name: string;
	email: string;
	subject: string;
	message: string;
}

export interface RecurringSkippedEvent {
	seriesId: string;
	userId: string;
	userName: string;
	userEmail: string;
	/** The date that was skipped (YYYY-MM-DD in America/Los_Angeles) */
	skippedDate: string;
	startTime: string;
	endTime: string;
	/** Why it was skipped */
	reason: string;
}

export interface EventRecurringReservationSkippedEvent {
	seriesId: string;
	/** The generated draft event that could not reserve space */
	eventId: string;
	eventTitle: string;
	userId: string;
	userName: string;
	userEmail: string;
	/** The date that could not be reserved (YYYY-MM-DD in America/Los_Angeles) */
	date: string;
	startTime: string;
	endTime: string;
	reason: string;
}

export interface EquipmentLoanRequestedEvent {
	loanId: string;
	userId: string;
	userName: string;
	userEmail: string;
	equipmentName: string | null;
	memberNotes: string | null;
	requestedPickupDate: string;
}

export interface EquipmentLoanScheduledEvent {
	loanId: string;
	userId: string;
	userName: string;
	userEmail: string;
	equipmentName: string;
	scheduledPickupDate: string;
}

export interface EquipmentCheckedOutEvent {
	loanId: string;
	userId: string;
	userName: string;
	userEmail: string;
	equipmentName: string;
}

export interface EquipmentReturnedEvent {
	loanId: string;
	userId: string;
	userName: string;
	userEmail: string;
	equipmentName: string;
	totalChargeCents: number;
	creditsCents: number;
	cashCents: number;
	daysBorrowed: number;
}

export interface PlatformInviteCreatedEvent {
	email: string;
	token: string;
	bandId: string;
	bandName: string;
	role: string;
	invitedByName: string;
}

export interface RecurringWaitlistedEvent {
	seriesId: string;
	userId: string;
	userName: string;
	userEmail: string;
	date: string;
	startTime: string;
	endTime: string;
	reason: string;
}

export interface WaitlistSlotAvailableEvent {
	reservationId: string;
	userId: string;
	userName: string;
	userEmail: string;
	date: string;
	startTime: string;
	endTime: string;
	expiresAt: string;
	confirmUrl: string;
}

export interface WaitlistExpiredEvent {
	reservationId: string;
	userId: string;
	userName: string;
	userEmail: string;
	date: string;
	startTime: string;
	endTime: string;
}

/**
 * A member wrote to another member. Carries the recipient explicitly rather
 * than leaving a listener to fan out over participants and remember to drop the
 * author — a two-party thread makes that mistake easy, and the mistake is
 * notifying someone about their own message.
 *
 * Deliberately carries no message text. The notification for a DM says who
 * wrote (or, for a request, not even that) and never what they said.
 */
export interface InboxDirectMessageEvent {
	threadId: string;
	messageId: string;
	senderId: string;
	senderName: string;
	recipientId: string;
	/** True when this is a first message awaiting acceptance. */
	isRequest: boolean;
}

export interface InboxMessageReceivedEvent {
	threadId: string;
	messageId: string;
	channel: string;
	contactName: string | null;
	preview: string;
}

export interface InboxMessageSentEvent {
	threadId: string;
	messageId: string;
	channel: string;
	sentByUserId: string;
}

/** Staff set a status and/or wrote a public reply on a member's suggestion. */
export interface SuggestionRespondedEvent {
	suggestionId: string;
	title: string;
	authorUserId: string;
	authorName: string;
	authorEmail: string;
	status: string;
	statusLabel: string;
	responseBody: string | null;
}

/**
 * A member's suggestion moved on or off the board. Covers all four reasons —
 * withheld by a report, restored after a dismissal, approved out of review, and
 * hidden by staff — because to the author they are one question: where did my
 * suggestion go?
 */
export interface SuggestionModeratedEvent {
	suggestionId: string;
	title: string;
	authorUserId: string;
	authorName: string;
	authorEmail: string;
	visibility: string;
	note: string | null;
	/** Present when a report caused the move. */
	flagId?: string;
}

/** Staff approved or turned down a proposed edit to a member's suggestion. */
export interface SuggestionEditReviewedEvent {
	suggestionId: string;
	title: string;
	authorUserId: string;
	authorName: string;
	authorEmail: string;
	approved: boolean;
	notes: string | null;
}

export interface ContentFlaggedEvent {
	flagId: string;
	entityType: string;
	entityId: string;
	entityLabel: string;
	reason: string;
	/** Null for anonymous public reports (event listings). */
	reportedByUserId: string | null;
	reportedByName: string;
}

/**
 * A band was named on someone else's bill and hasn't answered yet. Carries
 * everything the listener needs so notification handlers stay DB-free, the
 * same shape `EventUnpublishedByStaffEvent` uses.
 */
export interface EventLineupInvitedEvent {
	eventId: string;
	eventTitle: string;
	/** ISO string — payload dates cross the bus serialized. */
	startsAt: string;
	invitedBandId: string;
	invitedBandName: string;
	invitedBandSlug: string;
	/** Null for a CMC-produced show, where staff booked the bill. */
	ownerBandName: string | null;
	/** Owner/admins of the invited band. */
	bandAdmins: Array<{
		userId: string;
		userName: string;
		userEmail: string;
	}>;
}

export interface EventUnpublishedByStaffEvent {
	eventId: string;
	eventTitle: string;
	bandId: string;
	bandName: string;
	/** Staff resolution note, shared with the band so they can fix and republish. */
	notes: string | null;
	/** Band owner/admins to notify */
	bandAdmins: Array<{
		userId: string;
		userName: string;
		userEmail: string;
	}>;
}

/** A member's community listing entered the staff review queue. */
export interface CommunityEventSubmittedEvent {
	eventId: string;
	eventTitle: string;
	submitterUserId: string;
	submitterName: string;
	/** ISO string, like every other date on this bus. */
	startsAt: string;
}

/** Staff approved or turned down a community listing. */
export interface CommunityEventReviewedEvent {
	eventId: string;
	eventTitle: string;
	submitterUserId: string;
	submitterName: string;
	submitterEmail: string;
	approved: boolean;
	/** Required on a rejection so the member can fix it and resubmit. */
	notes: string | null;
}

/** Staff pulled a published community listing off the guide. */
export interface CommunityEventUnpublishedEvent {
	eventId: string;
	eventTitle: string;
	submitterUserId: string;
	submitterName: string;
	submitterEmail: string;
	notes: string | null;
}

export interface VolunteerHoursSubmittedEvent {
	logId: string;
	userId: string;
	userName: string;
	userEmail: string;
	roleName: string;
	/** Display hours, not stored minutes — email copy shouldn't do arithmetic. */
	hours: number;
	/** ISO string, like every other date on this bus. */
	workedOn: string;
	description: string;
}

export interface VolunteerHoursReviewedEvent {
	logId: string;
	userId: string;
	userName: string;
	userEmail: string;
	roleName: string;
	hours: number;
	workedOn: string;
	reviewNotes: string | null;
	reviewedByName: string;
}

// ---------------------------------------------------------------------------
// Event map — keys are event names, values are payload types
// ---------------------------------------------------------------------------

export type DomainEvents = {
	'checkout.completed': CheckoutCompletedEvent;
	'reservation.confirmed': ReservationConfirmedEvent;
	'reservation.cancelled': ReservationCancelledEvent;
	'reservation.reminder_due': ReservationReminderDueEvent;
	'reservation.confirmation_reminder_due': ConfirmationReminderDueEvent;
	'ticket.purchased': TicketPurchasedEvent;
	'event.cancelled': EventCancelledEvent;
	'event.recurring_reservation_skipped': EventRecurringReservationSkippedEvent;
	'band.invitation_sent': BandInvitationSentEvent;
	'band.invitation_accepted': BandInvitationAcceptedEvent;
	'contact.form_submitted': ContactFormSubmittedEvent;
	'reservation.recurring_skipped': RecurringSkippedEvent;
	'reservation.recurring_waitlisted': RecurringWaitlistedEvent;
	'reservation.waitlist_slot_available': WaitlistSlotAvailableEvent;
	'reservation.waitlist_expired': WaitlistExpiredEvent;
	'equipment.loan_requested': EquipmentLoanRequestedEvent;
	'equipment.loan_scheduled': EquipmentLoanScheduledEvent;
	'equipment.checked_out': EquipmentCheckedOutEvent;
	'equipment.returned': EquipmentReturnedEvent;
	'platform_invite.created': PlatformInviteCreatedEvent;
	'inbox.message_received': InboxMessageReceivedEvent;
	'inbox.message_sent': InboxMessageSentEvent;
	'inbox.direct_message': InboxDirectMessageEvent;
	'content.flagged': ContentFlaggedEvent;
	'suggestion.responded': SuggestionRespondedEvent;
	'suggestion.moderated': SuggestionModeratedEvent;
	'suggestion.edit_reviewed': SuggestionEditReviewedEvent;
	'event.unpublished_by_staff': EventUnpublishedByStaffEvent;
	'community_event.submitted': CommunityEventSubmittedEvent;
	'community_event.reviewed': CommunityEventReviewedEvent;
	'community_event.unpublished': CommunityEventUnpublishedEvent;
	'event.lineup_invited': EventLineupInvitedEvent;
	'volunteer.hours_submitted': VolunteerHoursSubmittedEvent;
	'volunteer.hours_approved': VolunteerHoursReviewedEvent;
	'volunteer.hours_rejected': VolunteerHoursReviewedEvent;
	'volunteer.shift_reminder_due': VolunteerShiftEvent;
	'volunteer.shift_completed': VolunteerShiftEvent;
	'volunteer.shift_feedback_due': VolunteerShiftEvent;
};

// ---------------------------------------------------------------------------
// Singleton emitter
// ---------------------------------------------------------------------------

export const domainEvents = new Emittery<DomainEvents>();
