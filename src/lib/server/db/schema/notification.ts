import { sqliteTable, text, integer, index, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';

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

export interface NotificationTypeDef {
	key: string;
	label: string;
	/** Required, so a new type cannot ship without picking a bucket. */
	category: NotificationCategoryKey;
	description: string;
	defaults: {
		email: boolean;
		inApp: boolean;
		sms: boolean;
	};
	mandatory?: boolean;
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
		label: 'Membership receipt',
		description: 'Your receipt when you start a sustaining contribution',
		defaults: { email: true, inApp: true, sms: false },
		mandatory: true
	},
	{
		key: 'membership_renewal_receipt',
		category: 'membership',
		label: 'Monthly contribution receipt',
		description: 'A receipt each month your contribution renews',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'membership_payment_failed',
		category: 'membership',
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
		label: 'Membership cancellation scheduled',
		description: 'Confirmation of when your membership will end after you cancel',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'membership_ended',
		category: 'membership',
		label: 'Membership ended',
		description: 'When your contribution ends and your member credits reset',
		defaults: { email: true, inApp: true, sms: false },
		mandatory: true
	},
	{
		key: 'ticket_confirmation',
		category: 'shows',
		label: 'Ticket purchase confirmation',
		description: 'Confirmation email with your ticket codes after purchase',
		defaults: { email: true, inApp: true, sms: false },
		mandatory: true
	},
	{
		key: 'event_cancellation',
		category: 'shows',
		label: 'Event cancellation',
		description: 'Notification when an event you have tickets for is cancelled',
		defaults: { email: true, inApp: true, sms: false },
		mandatory: true
	},
	{
		key: 'check_in_reminder',
		category: 'shows',
		label: 'Event check-in reminder',
		description: 'Reminder before an event with your ticket code',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'reservation_reminder',
		category: 'practice-space',
		label: 'Reservation reminder',
		description: 'Reminder about upcoming reservations',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'confirmation_reminder',
		category: 'practice-space',
		label: 'Confirmation reminder',
		description: 'Reminder to confirm unconfirmed reservations',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'band_invitation',
		category: 'people',
		label: 'Band invitation',
		description: 'Notification when someone invites you to their band',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'band_invitation_accepted',
		category: 'people',
		label: 'Band invitation accepted',
		description: 'Notification when someone accepts your band invitation',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'band_enquiry_received',
		category: 'people',
		label: 'Booking enquiry',
		description: 'Notification when someone contacts one of your bands through its booking form',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'recurring_skipped',
		category: 'practice-space',
		label: 'Recurring reservation skipped',
		description: 'Notification when a recurring reservation is skipped due to a conflict',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'event_recurring_reservation_skipped',
		category: 'practice-space',
		label: 'Recurring event could not reserve space (staff)',
		description:
			'Notification when a generated recurring event could not reserve the practice space due to a conflict',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'recurring_waitlisted',
		category: 'practice-space',
		label: 'Recurring reservation waitlisted',
		description:
			'Notification when a recurring reservation instance is waitlisted due to a conflict',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'waitlist_slot_available',
		category: 'practice-space',
		label: 'Waitlist slot available',
		description:
			'Notification when a waitlisted reservation slot becomes available for confirmation',
		defaults: { email: true, inApp: true, sms: false },
		mandatory: true
	},
	{
		key: 'waitlist_expired',
		category: 'practice-space',
		label: 'Waitlist expired',
		description: 'Notification when a waitlisted reservation expires without confirmation',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'equipment_loan_scheduled',
		category: 'practice-space',
		label: 'Equipment loan confirmed',
		description: 'Notification when staff confirms your equipment pickup',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'equipment_loan_requested',
		category: 'practice-space',
		label: 'Equipment loan requested (staff)',
		description: 'Notification when a member requests equipment',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'equipment_checked_out',
		category: 'practice-space',
		label: 'Equipment checked out',
		description: 'Confirmation when you check out equipment',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'equipment_returned',
		category: 'practice-space',
		label: 'Equipment returned',
		description: 'Summary when your equipment return is recorded',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'reservation_confirmed',
		category: 'practice-space',
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
		label: 'Reservation cancelled',
		description: 'Notification when your reservation is cancelled by staff',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'contact_form',
		category: 'people',
		label: 'Contact form submission',
		description: 'Forwarded contact form messages (staff only)',
		defaults: { email: true, inApp: false, sms: false },
		mandatory: true
	},
	{
		key: 'inbox_message_received',
		category: 'people',
		label: 'New inbox message (staff)',
		description: 'Notification when a new message arrives in the staff inbox',
		defaults: { email: false, inApp: true, sms: false }
	},
	{
		key: 'portal_message_reply',
		category: 'people',
		label: 'Reply to your message',
		description: 'Notification when staff reply to a conversation you started from your portal',
		// Email defaults on: they asked a question and may not come back to the
		// site on their own to find the answer.
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'instructor_application_submitted',
		category: 'volunteering',
		label: 'Teaching application',
		description: 'When a member applies to teach at the Collective',
		// Staff-facing. Email on, because an application nobody looks at is a
		// member waiting on silence.
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'instructor_application_reviewed',
		category: 'volunteering',
		label: 'Your teaching application',
		description: 'When staff approve your application to teach, or send it back for a change',
		// Email on, and this is the one that matters: a return state nobody
		// receives is the failure the return state exists to prevent. The member
		// would otherwise only find out by revisiting their profile.
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'direct_message_request',
		category: 'people',
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
		key: 'direct_message_received',
		category: 'people',
		label: 'New direct message',
		description: 'When a member you are talking with sends a message',
		// Names the sender — you accepted them — but still never the message.
		defaults: { email: true, inApp: true, sms: false },
		emailOmitsUserContent: true
	},
	{
		key: 'messaging_restricted',
		category: 'people',
		label: 'Messaging restricted',
		description: 'When staff limit your ability to start new conversations',
		// This one emails freely: it is CorvMC telling a member about a decision
		// we made, not one member reaching another through us.
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'inbox_assigned',
		category: 'people',
		label: 'Inbox conversation assigned (staff)',
		description: 'Notification when a staff inbox conversation is assigned to you',
		defaults: { email: false, inApp: true, sms: false }
	},
	{
		key: 'content_flagged',
		category: 'volunteering',
		label: 'Content flagged (staff)',
		description: 'Notification when a member reports a profile for review',
		defaults: { email: false, inApp: true, sms: false }
	},
	{
		key: 'band_lineup_invited',
		category: 'shows',
		label: 'Added to a bill',
		description: 'Notification when another band lists yours on the lineup for their show',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'band_event_unpublished',
		category: 'shows',
		label: 'Event unlisted by staff',
		description: 'Notification when staff unpublish one of your band’s events after a report',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'volunteer_hours_submitted',
		category: 'volunteering',
		label: 'Volunteer hours submitted (staff)',
		// In-app only, like the inbox and content-flag queues. A log every few
		// days is routine queue work; emailing every staffer would train them to
		// ignore it.
		description: 'Notification when a member logs volunteer hours for review',
		defaults: { email: false, inApp: true, sms: false }
	},
	{
		key: 'volunteer_hours_approved',
		category: 'volunteering',
		label: 'Volunteer hours approved',
		description: 'Notification when staff approve volunteer hours you logged',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'volunteer_hours_rejected',
		category: 'volunteering',
		label: 'Volunteer hours returned',
		description: 'Notification when staff return volunteer hours you logged, with a reason',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'volunteer_shift_claimed',
		category: 'volunteering',
		label: 'Volunteer shift claimed (staff)',
		// In-app only, like the hours queue above and for the same reason: it is
		// queue work, not news. But it has to exist — until now a claim produced
		// no signal at all, and confirming is what turns it into a booking that
		// gets a reminder and completes afterwards.
		description: 'Notification when a member claims a volunteer shift and needs confirming',
		defaults: { email: false, inApp: true, sms: false }
	},
	{
		key: 'volunteer_shift_confirmed',
		category: 'volunteering',
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
		label: 'Volunteer dropped a shift (staff)',
		// In-app only. The useful half is that a place reopened, which is a
		// coordinator's problem and nobody else's.
		description: 'Notification when somebody comes off a shift and their place reopens',
		defaults: { email: false, inApp: true, sms: false }
	},
	{
		key: 'volunteer_shift_cancelled',
		category: 'volunteering',
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
		label: 'Volunteer shift reminder',
		// Email on by default: the whole point is reaching somebody who isn't
		// looking at the site the day before a shift they agreed to work.
		description: 'Reminder the day before a shift you are confirmed for',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'volunteer_shift_completed',
		category: 'volunteering',
		label: 'Volunteer shift finished',
		// In-app only. The shift just happened — they know. This is the nudge to
		// log the hours, and it sits where the pre-filled log lives.
		description: 'A prompt to log your hours after a shift you worked',
		defaults: { email: false, inApp: true, sms: false }
	},
	{
		key: 'volunteer_shift_feedback',
		category: 'volunteering',
		label: 'How did your shift go?',
		description: 'A short survey the day after a shift you worked',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'orientation_confirmed',
		category: 'practice-space',
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
		key: 'community_event_submitted',
		category: 'shows',
		label: 'Community listing needs review (staff)',
		// In-app only, for the same reason as the volunteer queue above. Fires
		// only when a listing actually enters pending_review — a member saving a
		// draft is nobody's business but theirs.
		description: 'Notification when a member submits a community listing for review',
		defaults: { email: false, inApp: true, sms: false }
	},
	{
		key: 'community_event_reviewed',
		category: 'shows',
		label: 'Your community listing was reviewed',
		description: 'Notification when staff approve or turn down a listing you submitted',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'suggestion_responded',
		category: 'volunteering',
		label: 'Response to your suggestion',
		// Email on: a member who posted an idea and heard nothing assumes it went
		// nowhere, which is the exact failure this board exists to fix.
		description: 'Notification when staff reply to or change the status of a suggestion you posted',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'suggestion_moderated',
		category: 'volunteering',
		label: 'Your suggestion was moved',
		// Email on, and not optional in spirit: a suggestion can vanish from the
		// board because somebody reported it. Silence there reads as a shadowban.
		description:
			'Notification when a suggestion you posted is held for review, restored, approved, or hidden',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'suggestion_edit_reviewed',
		category: 'volunteering',
		label: 'Your edit was reviewed',
		// Email on: the member asked for something and is waiting on an answer.
		description:
			'Notification when staff approve or turn down an edit you proposed to your own suggestion',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'community_event_unpublished',
		category: 'shows',
		label: 'Your community listing was taken down',
		// Email on: the listing is off the guide and they need to know why,
		// which is not something to leave sitting in a bell icon.
		description: 'Notification when staff remove a listing you published',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'announcement',
		category: 'people',
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
	}
];

export function getNotificationType(key: string): NotificationTypeDef | undefined {
	return NOTIFICATION_TYPES.find((t) => t.key === key);
}

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
