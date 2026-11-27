import { sqliteTable, text, integer, index, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';
import type { Capability } from '../../../config';

// ---------------------------------------------------------------------------
// Notification type registry
// ---------------------------------------------------------------------------

/**
 * The five buckets a notification email is colour-coded by.
 *
 * Five because that is how many the brand palette can colour so they stay
 * tellable apart at a glance (#645); more would cost the signal the bar exists
 * to give. Declared here rather than imported so `db:generate` — which loads
 * this file through jiti, with no alias map — never has to resolve `$lib`.
 * The labels and hexes live in `src/lib/email/notification-category.ts`.
 */
export type NotificationCategoryKey =
	'practice-space' | 'shows' | 'membership' | 'people' | 'volunteering';

export type InAppDelivery = 'immediate' | 'digest' | 'digestIfLater';

export const DIGEST_HOLD_MS = 24 * 60 * 60 * 1000;

/** The `data` key that marks an in-app row as held for the daily digest. */
export const HELD_FOR_DIGEST = 'heldForDigest';

/** The type of the summary row the daily digest writes. */
export const DIGEST_TYPE = 'notification_digest';

export interface NotificationTypeDef {
	key: string;
	label: string;
	/** Required, so a new type cannot ship without picking a bucket. */
	category: NotificationCategoryKey;
	/**
	 * How the in-app notice reaches the bell. Required, so a new type cannot
	 * ship without picking one (#3409). Email is unaffected by it.
	 *
	 * - `immediate`: written and pushed at once. Anything time-critical, a
	 *   conversation, an expiring offer, or a notice nobody else will act on.
	 * - `digest`: held and delivered in the member's daily summary.
	 * - `digestIfLater`: held only when the thing it is about is more than 24 h
	 *   away; with no `happensAt` it is immediate, so it fails toward early.
	 */
	inAppDelivery: InAppDelivery;
	description: string;
	defaults: {
		email: boolean;
		inApp: boolean;
		sms: boolean;
	};
	mandatory?: boolean;
	/**
	 * Only holders of one of these can receive it: the capability its fan-out
	 * names, or the one that reads the staff mailbox it goes to. Anyone else's
	 * preference row for it would be inert as well as confusing (#899, #2985).
	 */
	forHolders?: readonly Capability[];
	/**
	 * Also reaches a committee seat: a task's notice goes to its position, then
	 * its committee, before any capability holder (#2990).
	 */
	forSeats?: boolean;
	/**
	 * This type's email must never carry text a member wrote.
	 *
	 * Enforced in the email layer rather than at the call site: there are ~23
	 * hand-built email models across the listeners, and "remember not to pass the
	 * message text" is a habit, not a rule. `normalizeNotificationModel` strips
	 * `quote`/`quote_text` for these types, in the same place it already escapes
	 * them precisely so callers cannot forget.
	 *
	 * Set on the direct-message types. Email is the one channel that blocking and
	 * reporting cannot reach — once a member's words are in someone's mailbox,
	 * they are there permanently — so DM emails say a message is waiting and
	 * link to the site, and never quote it.
	 */
	emailOmitsUserContent?: boolean;
}

export const NOTIFICATION_TYPES: NotificationTypeDef[] = [
	{
		key: 'audio_purchase_receipt',
		category: 'membership',
		inAppDelivery: 'digest',
		label: 'Music purchase receipt',
		description: 'Your download link and receipt after buying a release',
		defaults: { email: true, inApp: true, sms: false },
		// Mandatory, and not merely as a policy preference: for a buyer with no
		// account this email carries the ONLY copy of their download link. Letting
		// it be switched off would let somebody opt out of receiving the thing
		// they bought.
		mandatory: true
	},
	// --- Membership (sustaining contribution) -----------------------------
	// A member's contribution is a donation to a nonprofit, so the money types
	// here are mandatory for the same reason the audio receipt is: they are the
	// member's record of it. The two that are not mandatory are the ones a
	// reasonable person might tire of — a monthly renewal notice, and a
	// confirmation of something they just did themselves.
	{
		key: 'membership_receipt',
		category: 'membership',
		inAppDelivery: 'digest',
		label: 'Membership receipt',
		description: 'Your receipt when you start a sustaining contribution',
		defaults: { email: true, inApp: true, sms: false },
		mandatory: true
	},
	{
		key: 'membership_renewal_receipt',
		category: 'membership',
		inAppDelivery: 'digest',
		label: 'Monthly contribution receipt',
		description: 'A receipt each month your contribution renews',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'membership_payment_failed',
		category: 'membership',
		inAppDelivery: 'immediate',
		label: 'Contribution payment failed',
		description: 'When a card is declined and your membership needs attention',
		defaults: { email: true, inApp: true, sms: false },
		// Mandatory because it is the only warning before the membership lapses:
		// Stripe retries a handful of times and then cancels. Someone who had
		// switched this off would find out by losing their rehearsal hours.
		mandatory: true
	},
	{
		key: 'membership_cancellation_scheduled',
		category: 'membership',
		inAppDelivery: 'digest',
		label: 'Membership cancellation scheduled',
		description: 'Confirmation of when your membership will end after you cancel',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'membership_ended',
		category: 'membership',
		inAppDelivery: 'digest',
		label: 'Membership ended',
		description: 'When your contribution ends and your member credits reset',
		defaults: { email: true, inApp: true, sms: false },
		mandatory: true
	},
	{
		key: 'ticket_confirmation',
		category: 'shows',
		inAppDelivery: 'digestIfLater',
		label: 'Ticket purchase confirmation',
		description: 'Confirmation email with your ticket codes after purchase',
		defaults: { email: true, inApp: true, sms: false },
		mandatory: true
	},
	{
		key: 'event_cancellation',
		category: 'shows',
		inAppDelivery: 'digestIfLater',
		label: 'Event cancellation',
		description: 'Notification when an event you have tickets for is cancelled',
		defaults: { email: true, inApp: true, sms: false },
		mandatory: true
	},
	{
		key: 'check_in_reminder',
		category: 'shows',
		inAppDelivery: 'immediate',
		label: 'Event check-in reminder',
		description: 'Reminder before an event with your ticket code',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'reservation_reminder',
		category: 'practice-space',
		inAppDelivery: 'immediate',
		label: 'Reservation reminder',
		description: 'Reminder about upcoming reservations',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'door_code_ready',
		category: 'practice-space',
		inAppDelivery: 'immediate',
		label: 'Door code ready',
		description: 'Your door code, once the lock has confirmed it',
		defaults: { email: true, inApp: true, sms: false },
		// Mandatory: it is how a member without a standing code gets in.
		mandatory: true
	},
	{
		key: 'reservation_payment_due',
		category: 'practice-space',
		inAppDelivery: 'digest',
		label: 'Payment due',
		description: 'Reminder 1, 7 and 21 days after a reservation ends unpaid',
		defaults: { email: true, inApp: true, sms: false },
		// Mandatory: it is a notice of a debt that holds bookings and door codes.
		mandatory: true
	},
	{
		key: 'band_invitation',
		category: 'people',
		inAppDelivery: 'immediate',
		label: 'Band invitation',
		description: 'Notification when someone invites you to their band',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'band_invitation_accepted',
		category: 'people',
		inAppDelivery: 'digest',
		label: 'Band invitation accepted',
		description: 'Notification when someone accepts your band invitation',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'group_member_added',
		category: 'people',
		inAppDelivery: 'digest',
		label: 'Added to a club or committee',
		description: 'When staff add you to a club or committee roster',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'group_application_submitted',
		category: 'people',
		inAppDelivery: 'digest',
		label: 'Group application',
		description: 'When someone applies to join a club or committee you run',
		// Not staff-only: a chair is a member. Email on, because the applicant is
		// waiting and the chair has no other reason to open the page.
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'band_enquiry_received',
		category: 'people',
		inAppDelivery: 'immediate',
		label: 'Booking enquiry',
		description: 'Notification when someone contacts one of your bands through its booking form',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'recurring_skipped',
		category: 'practice-space',
		inAppDelivery: 'digestIfLater',
		label: 'Recurring reservation skipped',
		description: 'Notification when a recurring reservation is skipped due to a conflict',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'event_recurring_reservation_skipped',
		category: 'practice-space',
		inAppDelivery: 'digestIfLater',
		label: 'Recurring event could not reserve space',
		description:
			'Notification when a generated recurring event could not reserve the practice space due to a conflict',
		defaults: { email: true, inApp: true, sms: false },
		forHolders: ['event.manage']
	},
	{
		key: 'recurring_rescheduled',
		category: 'practice-space',
		inAppDelivery: 'digestIfLater',
		label: 'Recurring reservation changed',
		description: 'When staff change the day, time or frequency of your recurring reservation',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'recurring_waitlisted',
		category: 'practice-space',
		inAppDelivery: 'digestIfLater',
		label: 'Recurring reservation waitlisted',
		description:
			'Notification when a recurring reservation instance is waitlisted due to a conflict',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'waitlist_slot_available',
		category: 'practice-space',
		inAppDelivery: 'immediate',
		label: 'Waitlist slot available',
		description:
			'Notification when a waitlisted reservation slot becomes available for confirmation',
		defaults: { email: true, inApp: true, sms: false },
		mandatory: true
	},
	{
		key: 'waitlist_expired',
		category: 'practice-space',
		inAppDelivery: 'digestIfLater',
		label: 'Waitlist expired',
		description: 'Notification when a waitlisted reservation expires without confirmation',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'equipment_loan_scheduled',
		category: 'practice-space',
		inAppDelivery: 'digestIfLater',
		label: 'Equipment loan confirmed',
		description: 'Notification when staff confirms your equipment pickup',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'equipment_loan_requested',
		category: 'practice-space',
		inAppDelivery: 'digestIfLater',
		label: 'Equipment loan requested',
		description: 'Notification when a member requests equipment',
		defaults: { email: true, inApp: true, sms: false },
		forHolders: ['inventory.manageLoans']
	},
	{
		key: 'equipment_checked_out',
		category: 'practice-space',
		inAppDelivery: 'digest',
		label: 'Equipment checked out',
		description: 'Confirmation when you check out equipment',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'equipment_loan_due',
		category: 'practice-space',
		inAppDelivery: 'immediate',
		label: 'Equipment due back',
		description: 'Reminder the day before a loan is due, and again while it is late',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'development_deadline',
		category: 'membership',
		inAppDelivery: 'digest',
		label: 'Grant or sponsorship deadline',
		description: 'Two weeks and three days before a grant or sponsorship deadline you manage',
		defaults: { email: true, inApp: true, sms: false },
		forHolders: ['grant.manage', 'sponsor.manage']
	},
	{
		key: 'equipment_returned',
		category: 'practice-space',
		inAppDelivery: 'digest',
		label: 'Equipment returned',
		description: 'Summary when your equipment return is recorded',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'equipment_report_resolved',
		category: 'practice-space',
		inAppDelivery: 'digest',
		label: 'Something you reported was fixed',
		// Email on: the reporter is rarely looking at the unit's page, and hearing
		// back is what makes the next report worth filing.
		description: 'Notification when the equipment you reported a problem with has been seen to',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'reservation_confirmed',
		category: 'practice-space',
		inAppDelivery: 'digestIfLater',
		label: 'Reservation confirmed',
		description: 'Your confirmation when a booking is locked in',
		defaults: { email: true, inApp: true, sms: false }
		// Not mandatory, by the same rule the membership block states: this
		// confirms something the member just did themselves. The money side has
		// its own receipt.
	},
	{
		key: 'reservation_cancelled',
		category: 'practice-space',
		inAppDelivery: 'digestIfLater',
		label: 'Reservation cancelled',
		description: 'Notification when your reservation is cancelled by staff',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'contact_form',
		category: 'people',
		inAppDelivery: 'immediate',
		label: 'Contact form submission',
		description: 'Forwarded contact form messages',
		defaults: { email: true, inApp: false, sms: false },
		mandatory: true,
		forHolders: ['inbox.read']
	},
	{
		key: 'inbox_message_received',
		category: 'people',
		inAppDelivery: 'immediate',
		label: 'New inbox message',
		description: 'Notification when a new message arrives in the staff inbox',
		defaults: { email: false, inApp: true, sms: false },
		forHolders: ['inbox.read']
	},
	{
		key: 'portal_message_reply',
		category: 'people',
		inAppDelivery: 'immediate',
		label: 'Reply to your message',
		description: 'Notification when staff reply to a conversation you started from your portal',
		// Email defaults on: they asked a question and may not come back to the
		// site on their own to find the answer.
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'instructor_application_submitted',
		category: 'volunteering',
		inAppDelivery: 'digest',
		label: 'Teaching application',
		description: 'When a member applies to teach at the Collective',
		// Staff-facing. Email on, because an application nobody looks at is a
		// member waiting on silence.
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'instructor_application_reviewed',
		category: 'volunteering',
		inAppDelivery: 'digest',
		label: 'Your teaching application',
		description: 'When staff approve your application to teach, or send it back for a change',
		// Email on, and this is the one that matters: a return state nobody
		// receives is the failure the return state exists to prevent. The member
		// would otherwise only find out by revisiting their profile.
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'instructor_status_ended',
		category: 'volunteering',
		inAppDelivery: 'digest',
		label: 'Your teaching status',
		description: 'When staff pause or end your teaching',
		// Email on: a teacher with students booked would otherwise find out by looking.
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'direct_message_request',
		category: 'people',
		inAppDelivery: 'immediate',
		label: 'New message request',
		description: 'When another member asks to start a conversation with you',
		// Emails, but names neither the sender nor what they wrote — "you have a
		// new message request". Until you accept, we do not put a stranger's name
		// in your inbox. The message itself is in the Requests entry on the site,
		// which you open deliberately.
		defaults: { email: true, inApp: true, sms: false },
		emailOmitsUserContent: true
	},
	{
		key: 'group_chat_message',
		category: 'people',
		inAppDelivery: 'immediate',
		label: 'Your groups’ chat',
		description: 'When somebody posts in a band or club you are in',
		// In-app only by default. A chat is the highest-frequency thing on the
		// site and a room of five people can produce twenty messages in an hour;
		// mailing each one would teach people to filter the whole sender.
		defaults: { email: false, inApp: true, sms: false },
		emailOmitsUserContent: true
	},
	{
		key: 'direct_message_received',
		category: 'people',
		inAppDelivery: 'immediate',
		label: 'New direct message',
		description: 'When a member you are talking with sends a message',
		// Names the sender — you accepted them — but still never the message.
		defaults: { email: true, inApp: true, sms: false },
		emailOmitsUserContent: true
	},
	{
		key: 'messaging_restricted',
		category: 'people',
		inAppDelivery: 'immediate',
		label: 'Messaging restricted',
		description: 'When staff limit your ability to start new conversations',
		// This one emails freely: it is CorvMC telling a member about a decision
		// we made, not one member reaching another through us.
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'inbox_assigned',
		category: 'people',
		inAppDelivery: 'immediate',
		label: 'Inbox conversation assigned',
		description: 'Notification when a staff inbox conversation is assigned to you',
		defaults: { email: false, inApp: true, sms: false },
		forHolders: ['inbox.read']
	},
	{
		key: 'content_flagged',
		category: 'volunteering',
		inAppDelivery: 'immediate',
		label: 'Content flagged',
		description: 'Notification when a member reports a profile for review',
		defaults: { email: false, inApp: true, sms: false },
		forHolders: ['moderation.reviewFlags']
	},
	{
		key: 'band_lineup_invited',
		category: 'shows',
		inAppDelivery: 'digestIfLater',
		label: 'Added to a bill',
		description: 'Notification when another band lists yours on the lineup for their show',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'radio_attestation_expiring',
		category: 'shows',
		inAppDelivery: 'digest',
		label: 'Radio attestation expiring',
		description: 'A month and a week before a release’s yearly CMC Radio attestation runs out',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'production_cancelled',
		category: 'shows',
		inAppDelivery: 'digestIfLater',
		label: 'Show cancelled',
		description:
			'When a show your committee still owes something on is cancelled, what was called off, and by whom',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'deliverable_due',
		category: 'shows',
		inAppDelivery: 'digestIfLater',
		label: 'Show work due',
		description:
			'Three days before one of your committee’s items on a show is due, and again once it is late',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'task_assigned',
		category: 'volunteering',
		inAppDelivery: 'digest',
		label: 'Task assigned',
		description: 'When somebody assigns you a task',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'task_ready',
		category: 'volunteering',
		inAppDelivery: 'digest',
		label: 'Task ready',
		description: 'When the last task one of your tasks waits on is done',
		defaults: { email: false, inApp: true, sms: false }
	},
	{
		key: 'band_event_unpublished',
		category: 'shows',
		inAppDelivery: 'digestIfLater',
		label: 'Event unlisted by staff',
		description: 'Notification when staff unpublish one of your band’s events after a report',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'volunteer_hours_submitted',
		category: 'volunteering',
		inAppDelivery: 'digest',
		label: 'Volunteer hours submitted',
		// In-app only, like the inbox and content-flag queues. A log every few
		// days is routine queue work; emailing every staffer would train them to
		// ignore it.
		description: 'Notification when logged volunteer hours need a staff review',
		defaults: { email: false, inApp: true, sms: false },
		forHolders: ['volunteer.reviewHours']
	},
	{
		key: 'volunteer_hours_approved',
		category: 'volunteering',
		inAppDelivery: 'digest',
		label: 'Volunteer hours approved',
		description: 'Notification when staff approve volunteer hours you logged',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'volunteer_hours_rejected',
		category: 'volunteering',
		inAppDelivery: 'digest',
		label: 'Volunteer hours returned',
		description: 'Notification when staff return volunteer hours you logged, with a reason',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'volunteer_shift_invited',
		category: 'volunteering',
		inAppDelivery: 'digestIfLater',
		label: 'Invited to a shift',
		// Email on. An invitation is a question addressed to one person, and a
		// question nobody sees is not a chase — which is the whole reason this
		// exists rather than staff adding them and hoping.
		description: 'Notification when a coordinator asks you to take a shift',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'volunteer_shift_opened',
		category: 'volunteering',
		inAppDelivery: 'immediate',
		label: 'Open shifts in your roles',
		// Email only by default: the board is the in-app view of the same thing.
		// One email a day at 9am club time, listing every new shift in the
		// member's roles (#3239, #3258).
		description: 'A daily email of new shifts in volunteer roles you picked',
		defaults: { email: true, inApp: false, sms: false }
	},
	{
		key: 'volunteer_shift_declined',
		category: 'volunteering',
		inAppDelivery: 'digestIfLater',
		label: 'A shift invitation was declined',
		// In-app only and staff-only: it is the answer to a question they asked,
		// and it belongs next to the shift rather than in their inbox.
		description: 'Notification when somebody you invited to a shift says no',
		defaults: { email: false, inApp: true, sms: false },
		forHolders: ['volunteer.manageShifts'],
		forSeats: true
	},
	{
		key: 'volunteer_shift_claimed',
		category: 'volunteering',
		inAppDelivery: 'digestIfLater',
		label: 'Volunteer shift claimed',
		// In-app only, like the hours queue above and for the same reason: it is
		// queue work, not news. But it has to exist — until now a claim produced
		// no signal at all, and confirming is what turns it into a booking that
		// gets a reminder and completes afterwards.
		description: 'Notification when a member claims a volunteer shift and needs confirming',
		defaults: { email: false, inApp: true, sms: false },
		forHolders: ['volunteer.manageShifts']
	},
	{
		key: 'volunteer_shift_confirmed',
		category: 'volunteering',
		inAppDelivery: 'digestIfLater',
		label: 'You are on the roster',
		// Email on: this is the message that turns "I put my hand up" into "I am
		// expected on Saturday", and it is the only one the member gets before
		// the day-before reminder.
		description: 'Notification when staff confirm you for a shift, or put you on one',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'volunteer_shift_dropped',
		category: 'volunteering',
		inAppDelivery: 'digestIfLater',
		label: 'Volunteer dropped a shift',
		// In-app only. The useful half is that a place reopened, which is a
		// coordinator's problem and nobody else's.
		description: 'Notification when somebody comes off a shift and their place reopens',
		defaults: { email: false, inApp: true, sms: false },
		forHolders: ['volunteer.manageShifts'],
		forSeats: true
	},
	{
		key: 'volunteer_shift_cancelled',
		category: 'volunteering',
		inAppDelivery: 'digestIfLater',
		label: 'A shift you were on was called off',
		// Email on, and not optional in practice: somebody has arranged their
		// Saturday around this. It is the one volunteer notification whose whole
		// job is to stop a person turning up to a locked building.
		description: 'Notification when a shift you had claimed or were booked on is called off',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'volunteer_shift_reminder',
		category: 'volunteering',
		inAppDelivery: 'immediate',
		label: 'Volunteer shift reminder',
		// Email on by default: the whole point is reaching somebody who isn't
		// looking at the site the day before a shift they agreed to work.
		description: 'Reminder the day before a shift you are confirmed for',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'volunteer_shift_completed',
		category: 'volunteering',
		inAppDelivery: 'digest',
		label: 'Volunteer shift finished',
		// In-app only. The shift just happened — they know. This is the nudge to
		// log the hours, and it sits where the pre-filled log lives.
		description: 'A prompt to log your hours after a shift you worked',
		defaults: { email: false, inApp: true, sms: false }
	},
	{
		key: 'volunteer_shift_feedback',
		category: 'volunteering',
		inAppDelivery: 'digest',
		label: 'How did your shift go?',
		description: 'A short survey the day after a shift you worked',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'orientation_confirmed',
		category: 'practice-space',
		inAppDelivery: 'digestIfLater',
		label: 'Someone is meeting you at the space',
		// Email on, and deliberately not sent when the shift is *created*: "we
		// hope somebody will meet you" is not information. "Sam is meeting you at
		// 6:45 on Thursday" is, and it is the only message a first-time member
		// gets between booking and turning up.
		description:
			'Notification when a volunteer is confirmed to show you around on your first booking',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'first_visit',
		category: 'practice-space',
		inAppDelivery: 'immediate',
		label: 'First visit',
		// Sent in place of the reservation reminder for that booking.
		description:
			'The day before your first reservation: when to arrive, where to go, and the house rules',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'orientation_unclaimed',
		category: 'volunteering',
		inAppDelivery: 'immediate',
		label: 'Unstaffed orientation',
		description: 'A day before an orientation shift that has no volunteer signed up',
		defaults: { email: true, inApp: true, sms: false },
		forHolders: ['volunteer.manageShifts'],
		forSeats: true
	},
	{
		key: 'community_event_submitted',
		category: 'shows',
		inAppDelivery: 'digest',
		label: 'Community listing needs review',
		// In-app only, for the same reason as the volunteer queue above. Fires
		// only when a listing actually enters pending_review — a member saving a
		// draft is nobody's business but theirs.
		description: 'Notification when a member submits a community listing for review',
		defaults: { email: false, inApp: true, sms: false },
		forHolders: ['listing.review']
	},
	{
		key: 'local_resource_submitted',
		category: 'people',
		inAppDelivery: 'digest',
		label: 'Local resource tip needs review',
		description: 'Notification when someone suggests a listing for the Local Resources page',
		defaults: { email: false, inApp: true, sms: false },
		forHolders: ['localResource.manage']
	},
	{
		key: 'community_event_reviewed',
		category: 'shows',
		inAppDelivery: 'digestIfLater',
		label: 'Your community listing was reviewed',
		description: 'Notification when staff approve or turn down a listing you submitted',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'suggestion_responded',
		category: 'volunteering',
		inAppDelivery: 'digest',
		label: 'Response to your suggestion',
		// Email on: a member who posted an idea and heard nothing assumes it went
		// nowhere, which is the exact failure this board exists to fix.
		description: 'Notification when staff reply to or change the status of a suggestion you posted',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'suggestion_moderated',
		category: 'volunteering',
		inAppDelivery: 'digest',
		label: 'Your suggestion was moved',
		// Email on, and not optional in spirit: a suggestion can vanish from the
		// board because somebody reported it. Silence there reads as a shadowban.
		description:
			'Notification when a suggestion you posted is held for review, restored, approved, or hidden',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'classified_expiring',
		category: 'people',
		inAppDelivery: 'digest',
		label: 'Classified post expiring',
		description: 'Reminder three days before a classified post you made leaves the board',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'classified_moderated',
		category: 'people',
		inAppDelivery: 'digest',
		label: 'Classified post reviewed',
		// Email on: a takedown note is the author's only route back to the board.
		description: 'Notification when staff approve, restore or take down a classified post you made',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'moderation_appeal_filed',
		category: 'people',
		inAppDelivery: 'digest',
		label: 'Moderation appeal filed',
		// In-app only: a queue item, not news. The Content Flags badge counts them.
		description: 'Notification when a member appeals an upheld report',
		defaults: { email: false, inApp: true, sms: false },
		forHolders: ['moderation.reviewFlags']
	},
	{
		key: 'moderation_appeal_decided',
		category: 'people',
		inAppDelivery: 'digest',
		label: 'Your appeal was decided',
		// Email on: the member asked and is waiting, and silence reads as being ignored.
		description: 'Notification when staff answer an appeal you filed',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'suggestion_edit_reviewed',
		category: 'volunteering',
		inAppDelivery: 'digest',
		label: 'Your edit was reviewed',
		// Email on: the member asked for something and is waiting on an answer.
		description:
			'Notification when staff approve or turn down an edit you proposed to your own suggestion',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'community_event_unpublished',
		category: 'shows',
		inAppDelivery: 'digestIfLater',
		label: 'Your community listing was taken down',
		// Email on: the listing is off the guide and they need to know why,
		// which is not something to leave sitting in a bell icon.
		description: 'Notification when staff remove a listing you published',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'announcement',
		category: 'people',
		inAppDelivery: 'immediate',
		label: 'Group announcements',
		// One key rather than one per kind. Four near-identical rows in the
		// preferences UI would be one user decision, and adding a kind would
		// become a registry change plus a UI change. The kind goes in the payload
		// and the copy.
		//
		// This preference is global to announcements. The per-group mute is
		// `group_member.notifyAnnouncements`, which this cannot express: a member
		// of six groups needs to silence one without silencing all.
		description: 'Posts from bands, clubs, and committees you belong to',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'ballot_opened',
		category: 'membership',
		inAppDelivery: 'immediate',
		label: 'A ballot you can vote on opened',
		// Email on: it goes only to the roll, and a vote missed is not recoverable.
		description: 'When a committee or member-wide ballot opens and you are on its roll',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: DIGEST_TYPE,
		category: 'membership',
		inAppDelivery: 'immediate',
		label: 'Daily summary',
		// Written straight to the bell by the daily digest, never through a
		// preference: there is no email, so the category colour is never shown.
		description: "The day's held notices, gathered into one entry in the bell",
		defaults: { email: false, inApp: true, sms: false },
		mandatory: true
	},
	{
		key: 'ballot_result',
		category: 'membership',
		inAppDelivery: 'immediate',
		label: 'Ballot results',
		// In-app only by default: this reaches every member, and a whole-membership
		// email belongs on the broadcast stream, not the transactional one.
		description: 'When the result of a ballot is certified',
		defaults: { email: false, inApp: true, sms: false }
	}
];

/**
 * Whether an in-app notice waits for the daily digest. Unknown types and a
 * missing or past `happensAt` resolve immediate, so a gap here is an early
 * notice, never a late one.
 */
export function holdsForDigest(
	type: string,
	happensAt: Date | undefined,
	now: Date = new Date()
): boolean {
	const delivery = getNotificationType(type)?.inAppDelivery;
	if (delivery === 'digest') return true;
	if (delivery !== 'digestIfLater' || !happensAt) return false;
	return happensAt.getTime() - now.getTime() > DIGEST_HOLD_MS;
}

export function getNotificationType(key: string): NotificationTypeDef | undefined {
	return NOTIFICATION_TYPES.find((t) => t.key === key);
}

/**
 * The switches one audience may be offered.
 *
 * `mandatory` was the only filter for a long time, so every member's
 * preferences table listed nine staff-only types (#899). Audience is a field
 * here rather than a "(staff)" suffix on the label, so the query can act on it.
 */
/** The switches to offer someone who holds `held`. */
export function preferenceTypesFor(held: ReadonlySet<string>): NotificationTypeDef[] {
	return NOTIFICATION_TYPES.filter((t) => !t.mandatory && receivable(t, held));
}

/** In `held`: the person sits on a committee, so `forSeats` types reach them. */
export const SEAT_HOLDER = 'committee seat';

/** Can someone holding `held` ever receive this type? */
export function receivable(t: NotificationTypeDef, held: ReadonlySet<string>): boolean {
	if (!t.forHolders) return true;
	if (t.forSeats && held.has(SEAT_HOLDER)) return true;
	return t.forHolders.some((c) => held.has(c));
}

/** Every capability some type is gated on, for resolving `held` once. */
export const NOTIFICATION_CAPABILITIES: readonly Capability[] = [
	...new Set(NOTIFICATION_TYPES.flatMap((t) => t.forHolders ?? []))
];

// ---------------------------------------------------------------------------
// In-app notifications
// ---------------------------------------------------------------------------

export const notification = sqliteTable(
	'notification',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		type: text('type').notNull(),
		title: text('title').notNull(),
		body: text('body'),
		href: text('href'),
		data: text('data', { mode: 'json' }),
		readAt: integer('read_at', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		index('idx_notification_user').on(t.userId),
		index('idx_notification_user_unread').on(t.userId, t.readAt)
	]
);

// ---------------------------------------------------------------------------
// Notification preferences
// ---------------------------------------------------------------------------

export const notificationPreference = sqliteTable(
	'notification_preference',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		notificationType: text('notification_type').notNull(),
		emailEnabled: integer('email_enabled', { mode: 'boolean' }).notNull().default(true),
		inAppEnabled: integer('in_app_enabled', { mode: 'boolean' }).notNull().default(true),
		smsEnabled: integer('sms_enabled', { mode: 'boolean' }).notNull().default(false),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(t) => [
		unique('uq_notification_pref_user_type').on(t.userId, t.notificationType),
		index('idx_notification_pref_user').on(t.userId)
	]
);

export type Notification = typeof notification.$inferSelect;
