import { sqliteTable, text, integer, index, unique } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { user } from './authentication';

// ---------------------------------------------------------------------------
// Notification type registry
// ---------------------------------------------------------------------------

export interface NotificationTypeDef {
	key: string;
	label: string;
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
		key: 'ticket_confirmation',
		label: 'Ticket purchase confirmation',
		description: 'Confirmation email with your ticket codes after purchase',
		defaults: { email: true, inApp: true, sms: false },
		mandatory: true
	},
	{
		key: 'event_cancellation',
		label: 'Event cancellation',
		description: 'Notification when an event you have tickets for is cancelled',
		defaults: { email: true, inApp: true, sms: false },
		mandatory: true
	},
	{
		key: 'check_in_reminder',
		label: 'Event check-in reminder',
		description: 'Reminder before an event with your ticket code',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'reservation_reminder',
		label: 'Reservation reminder',
		description: 'Reminder about upcoming reservations',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'confirmation_reminder',
		label: 'Confirmation reminder',
		description: 'Reminder to confirm unconfirmed reservations',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'band_invitation',
		label: 'Band invitation',
		description: 'Notification when someone invites you to their band',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'band_invitation_accepted',
		label: 'Band invitation accepted',
		description: 'Notification when someone accepts your band invitation',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'recurring_skipped',
		label: 'Recurring reservation skipped',
		description: 'Notification when a recurring reservation is skipped due to a conflict',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'event_recurring_reservation_skipped',
		label: 'Recurring event could not reserve space (staff)',
		description:
			'Notification when a generated recurring event could not reserve the practice space due to a conflict',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'recurring_waitlisted',
		label: 'Recurring reservation waitlisted',
		description:
			'Notification when a recurring reservation instance is waitlisted due to a conflict',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'waitlist_slot_available',
		label: 'Waitlist slot available',
		description:
			'Notification when a waitlisted reservation slot becomes available for confirmation',
		defaults: { email: true, inApp: true, sms: false },
		mandatory: true
	},
	{
		key: 'waitlist_expired',
		label: 'Waitlist expired',
		description: 'Notification when a waitlisted reservation expires without confirmation',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'equipment_loan_scheduled',
		label: 'Equipment loan confirmed',
		description: 'Notification when staff confirms your equipment pickup',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'equipment_loan_requested',
		label: 'Equipment loan requested (staff)',
		description: 'Notification when a member requests equipment',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'equipment_checked_out',
		label: 'Equipment checked out',
		description: 'Confirmation when you check out equipment',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'equipment_returned',
		label: 'Equipment returned',
		description: 'Summary when your equipment return is recorded',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'reservation_cancelled',
		label: 'Reservation cancelled',
		description: 'Notification when your reservation is cancelled by staff',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'contact_form',
		label: 'Contact form submission',
		description: 'Forwarded contact form messages (staff only)',
		defaults: { email: true, inApp: false, sms: false },
		mandatory: true
	},
	{
		key: 'inbox_message_received',
		label: 'New inbox message (staff)',
		description: 'Notification when a new message arrives in the staff inbox',
		defaults: { email: false, inApp: true, sms: false }
	},
	{
		key: 'portal_message_reply',
		label: 'Reply to your message',
		description: 'Notification when staff reply to a conversation you started from your portal',
		// Email defaults on: they asked a question and may not come back to the
		// site on their own to find the answer.
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'direct_message_request',
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
		label: 'New direct message',
		description: 'When a member you are talking with sends a message',
		// Names the sender — you accepted them — but still never the message.
		defaults: { email: true, inApp: true, sms: false },
		emailOmitsUserContent: true
	},
	{
		key: 'messaging_restricted',
		label: 'Messaging restricted',
		description: 'When staff limit your ability to start new conversations',
		// This one emails freely: it is CorvMC telling a member about a decision
		// we made, not one member reaching another through us.
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'inbox_assigned',
		label: 'Inbox conversation assigned (staff)',
		description: 'Notification when a staff inbox conversation is assigned to you',
		defaults: { email: false, inApp: true, sms: false }
	},
	{
		key: 'content_flagged',
		label: 'Content flagged (staff)',
		description: 'Notification when a member reports a profile for review',
		defaults: { email: false, inApp: true, sms: false }
	},
	{
		key: 'band_lineup_invited',
		label: 'Added to a bill',
		description: 'Notification when another band lists yours on the lineup for their show',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'band_event_unpublished',
		label: 'Event unlisted by staff',
		description: 'Notification when staff unpublish one of your band’s events after a report',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'volunteer_hours_submitted',
		label: 'Volunteer hours submitted (staff)',
		// In-app only, like the inbox and content-flag queues. A log every few
		// days is routine queue work; emailing every staffer would train them to
		// ignore it.
		description: 'Notification when a member logs volunteer hours for review',
		defaults: { email: false, inApp: true, sms: false }
	},
	{
		key: 'volunteer_hours_approved',
		label: 'Volunteer hours approved',
		description: 'Notification when staff approve volunteer hours you logged',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'volunteer_hours_rejected',
		label: 'Volunteer hours returned',
		description: 'Notification when staff return volunteer hours you logged, with a reason',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'volunteer_shift_reminder',
		label: 'Volunteer shift reminder',
		// Email on by default: the whole point is reaching somebody who isn't
		// looking at the site the day before a shift they agreed to work.
		description: 'Reminder the day before a shift you are confirmed for',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'volunteer_shift_completed',
		label: 'Volunteer shift finished',
		// In-app only. The shift just happened — they know. This is the nudge to
		// log the hours, and it sits where the pre-filled log lives.
		description: 'A prompt to log your hours after a shift you worked',
		defaults: { email: false, inApp: true, sms: false }
	},
	{
		key: 'volunteer_shift_feedback',
		label: 'How did your shift go?',
		description: 'A short survey the day after a shift you worked',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'community_event_submitted',
		label: 'Community listing needs review (staff)',
		// In-app only, for the same reason as the volunteer queue above. Fires
		// only when a listing actually enters pending_review — a member saving a
		// draft is nobody's business but theirs.
		description: 'Notification when a member submits a community listing for review',
		defaults: { email: false, inApp: true, sms: false }
	},
	{
		key: 'community_event_reviewed',
		label: 'Your community listing was reviewed',
		description: 'Notification when staff approve or turn down a listing you submitted',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'suggestion_responded',
		label: 'Response to your suggestion',
		// Email on: a member who posted an idea and heard nothing assumes it went
		// nowhere, which is the exact failure this board exists to fix.
		description: 'Notification when staff reply to or change the status of a suggestion you posted',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'suggestion_moderated',
		label: 'Your suggestion was moved',
		// Email on, and not optional in spirit: a suggestion can vanish from the
		// board because somebody reported it. Silence there reads as a shadowban.
		description:
			'Notification when a suggestion you posted is held for review, restored, approved, or hidden',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'suggestion_edit_reviewed',
		label: 'Your edit was reviewed',
		// Email on: the member asked for something and is waiting on an answer.
		description:
			'Notification when staff approve or turn down an edit you proposed to your own suggestion',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'community_event_unpublished',
		label: 'Your community listing was taken down',
		// Email on: the listing is off the guide and they need to know why,
		// which is not something to leave sitting in a bell icon.
		description: 'Notification when staff remove a listing you published',
		defaults: { email: true, inApp: true, sms: false }
	},
	{
		key: 'announcement',
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
