import { notification, notificationPreference } from '../../src/lib/server/db/schema/notification';
import { db } from './db';
import { type SeedUser } from './types';
import { pickN, randomInt } from './util';

export async function seedNotifications(users: SeedUser[]) {
	console.log('Seeding notifications...');
	const rows = [];

	const types = [
		{
			type: 'reservation_reminder',
			title: 'Upcoming reservation',
			body: 'Your reservation is tomorrow at 2:00 PM.',
			href: '/member/reservations'
		},
		{
			type: 'confirmation_reminder',
			title: 'Please confirm your reservation',
			body: 'You have an unconfirmed reservation this week.',
			href: '/member/reservations'
		},
		{
			type: 'band_invitation',
			title: 'Band invitation',
			body: "You've been invited to join The Voltage Thieves.",
			href: '/member/bands'
		},
		{
			type: 'band_invitation_accepted',
			title: 'Invitation accepted',
			body: 'Jordan Nguyen accepted your band invitation.',
			href: '/member/bands'
		},
		{
			type: 'recurring_skipped',
			title: 'Recurring reservation skipped',
			body: 'Your weekly reservation was skipped due to a closure.',
			href: '/member/reservations'
		},
		{
			type: 'ticket_confirmation',
			title: 'Tickets confirmed',
			body: 'Your tickets for Open Mic Night are confirmed!',
			href: '/member/tickets'
		},
		{
			type: 'event_cancellation',
			title: 'Event cancelled',
			body: 'Outdoor Festival has been cancelled. Your tickets will be refunded.',
			href: '/member/tickets'
		}
	];

	for (const u of users) {
		const count = randomInt(0, 5);
		const selected = pickN(types, count);

		for (const n of selected) {
			const daysAgo = randomInt(0, 14);
			const createdAt = new Date(Date.now() - daysAgo * 86400000);
			const isRead = Math.random() > 0.4;

			const [row] = await db
				.insert(notification)
				.values({
					userId: u.id,
					type: n.type,
					title: n.title,
					body: n.body,
					href: n.href,
					readAt: isRead ? new Date(createdAt.getTime() + randomInt(1, 24) * 3600000) : null,
					createdAt
				})
				.returning();
			rows.push(row);
		}
	}

	return rows;
}

export async function seedNotificationPreferences(users: SeedUser[]) {
	console.log('Seeding notification preferences...');
	const rows = [];
	const configurableTypes = [
		'check_in_reminder',
		'reservation_reminder',
		'confirmation_reminder',
		'band_invitation',
		'band_invitation_accepted',
		'recurring_skipped'
	];

	const customizers = pickN(users, Math.ceil(users.length * 0.3));

	for (const u of customizers) {
		const tweaked = pickN(configurableTypes, randomInt(1, 3));
		for (const nt of tweaked) {
			const [row] = await db
				.insert(notificationPreference)
				.values({
					userId: u.id,
					notificationType: nt,
					emailEnabled: Math.random() > 0.3,
					inAppEnabled: Math.random() > 0.2
				})
				.returning();
			rows.push(row);
		}
	}

	return rows;
}
