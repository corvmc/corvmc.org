import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { reminderSent } from '#lib/server/db/schema/reminder.js';
import { dispatch, type DispatchOutcome } from '#lib/server/notification/dispatcher.js';
import { recordAuditEntry, memberSubject } from '#lib/server/audit/audit-service.js';
import type { ReservationPaymentDueEvent } from '#lib/server/event-bus/event-bus.js';
import type { NotificationEmailContent } from '#lib/types/notification-email.js';
import { formatCents, formatDateLong, formatSlotTime } from '#lib/utils/format.js';

/**
 * The stages, in days after the session ended (#2876). Bands, as the registry's
 * `OVERDUE_BANDS`: one drain sends one stage, and the last is floored so a fee
 * older than five weeks gets none.
 */
export const PAYMENT_DUE_BANDS = [
	{ days: 1, until: 7 },
	{ days: 7, until: 21 },
	{ days: 21, until: 35 }
] as const;

export const paymentDueKey = (days: number) => `reservation_payment_due_${days}d`;

/** The stages already sent for one booking, from the drain's sent-marks. */
export async function listPaymentRemindersSent(
	reservationId: string
): Promise<{ daysAfter: number; sentAt: Date }[]> {
	const rows = await db
		.select({ key: reminderSent.reminderKey, sentAt: reminderSent.sentAt })
		.from(reminderSent)
		.where(
			and(
				eq(reminderSent.subjectId, reservationId),
				inArray(
					reminderSent.reminderKey,
					PAYMENT_DUE_BANDS.map((b) => paymentDueKey(b.days))
				)
			)
		)
		.orderBy(asc(reminderSent.sentAt));
	return rows.map((r) => ({
		daysAfter: PAYMENT_DUE_BANDS.find((b) => paymentDueKey(b.days) === r.key)!.days,
		sentAt: r.sentAt
	}));
}

/** Thrown after a refused send is audited, so the drain leaves the stage owed. */
export class PaymentReminderFailed extends Error {
	constructor(reservationId: string) {
		super(`Payment reminder for ${reservationId} was not queued`);
		this.name = 'PaymentReminderFailed';
	}
}

function content(event: ReservationPaymentDueEvent, payUrl: string): NotificationEmailContent {
	const day = formatDateLong(new Date(`${event.date}T12:00:00Z`));
	const time = `${formatSlotTime(event.startTime)} – ${formatSlotTime(event.endTime)}`;
	const amount = event.amountCents == null ? null : formatCents(event.amountCents);
	return {
		recipientName: event.userName,
		subject: `Payment due for your ${day} reservation`,
		preview_text: amount ? `${amount} is due for ${day}.` : `A payment is due for ${day}.`,
		heading: 'Payment due',
		paragraphs: [
			{ text: `Your practice space reservation on ${day} has not been paid.` },
			{ text: 'New reservations and door codes are on hold until it is paid.' }
		],
		details: [
			{ label: 'Date', value: day },
			{ label: 'Time', value: time },
			...(amount ? [{ label: 'Amount due', value: amount }] : [])
		],
		footnote: 'To pay in cash or ask a question, open the reservation and choose Message staff.',
		cta: { label: 'Pay now', url: payUrl }
	};
}

/**
 * One payment reminder (#2876): the member's notification, then an audit row
 * for the attempt, whatever became of it. A refused send throws afterwards, so
 * the drain marks nothing and the next pass tries the stage again.
 */
export async function sendPaymentReminder(event: ReservationPaymentDueEvent): Promise<void> {
	let outcome: DispatchOutcome;
	try {
		outcome = await dispatch({
			type: 'reservation_payment_due',
			userId: event.userId,
			userEmail: event.userEmail,
			title: 'Payment due',
			body: `Your reservation on ${formatDateLong(new Date(`${event.date}T12:00:00Z`))}`,
			href: `/member/reservations/${event.reservationId}`,
			email: content(event, `/member/reservations/${event.reservationId}/pay`)
		});
	} catch {
		outcome = { email: 'failed' };
	}

	await recordAuditEntry({
		action: 'reservation.payment_reminder',
		subject: await memberSubject(event.userId),
		details: {
			reservationId: event.reservationId,
			date: event.date,
			startTime: event.startTime,
			endTime: event.endTime,
			daysAfter: event.daysAfter,
			amountCents: event.amountCents,
			outcome: outcome.email === 'queued' ? 'sent' : outcome.email,
			reason: outcome.email === 'skipped' ? outcome.reason : null,
			outboxId: outcome.email === 'queued' ? outcome.outboxId : null
		}
	});

	if (outcome.email === 'failed') throw new PaymentReminderFailed(event.reservationId);
}
