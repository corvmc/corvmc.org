import { db } from '$lib/server/db';
import { reservation } from '$lib/server/db/schema/reservation';
import { user } from '$lib/server/db/schema/authentication';
import { eq, ne, and, gt, gte, lt, isNotNull } from 'drizzle-orm';
import { formatDateFull, formatTimeSimple } from '$lib/server/reservation/timezone';
import { CONFIRMATION_WINDOW_DAYS, DEFAULT_TIMEZONE, clubToday } from '$lib/config';
import { addIsoDays } from '$lib/utils/deadline';
import { listDevelopmentDeadlinesBetween } from '$lib/server/development/deadline-service';
import {
	listSignupsStartingBetween,
	listCompletionsAwaitingFeedback
} from '$lib/server/volunteer/volunteer-signup-service';
import { listLoansDueBetween } from '$lib/server/inventory/loan-service';
import { listRenewalsExpiringBetween } from '$lib/server/renewal/renewal-service';
import { listRadioAttestationsExpiringBetween } from '$lib/server/audio/radio-attestation';
import { defineReminder, type ReminderDefinition } from './types';

const TZ = DEFAULT_TIMEZONE;
const DAY = 24 * 60 * 60 * 1000;

/**
 * The overdue stages, as the bands between them. The last one is floored
 * rather than open-ended: without it, switching these on would nag about every
 * loan ever lost, and a loan already fifteen days late would take all three
 * stages in one drain rather than the one it is actually at.
 */
const OVERDUE_BANDS = [
	{ days: 1, until: 3 },
	{ days: 3, until: 7 },
	{ days: 7, until: 30 }
] as const;

/** One overdue nag: due inside this stage's band, still out. */
function overdueLoans({ days, until }: { days: number; until: number }) {
	return defineReminder({
		key: `loan_overdue_${days}d`,
		subjectType: 'inventory_loan',
		event: 'equipment.loan_due' as const,
		async due(now: Date) {
			const rows = await listLoansDueBetween(
				new Date(now.getTime() - until * DAY),
				new Date(now.getTime() - days * DAY)
			);
			return rows.map((row) => ({
				subjectId: row.loanId,
				payload: {
					stage: 'overdue' as const,
					daysLate: days,
					loanId: row.loanId,
					userId: row.userId,
					userName: row.userName,
					userEmail: row.userEmail,
					equipmentName: row.equipmentName,
					dueDate: formatDateFull(row.dueDate, TZ)
				}
			}));
		}
	});
}

/**
 * One stage of Development's deadline reminders (#1477): every grant and
 * sponsorship deadline between `from` and `until` days from today. The subject
 * carries the date, so a deadline moved later is owed its reminders again.
 */
function developmentDeadlines(stage: '14d' | '3d', from: number, until: number) {
	return defineReminder({
		key: `development_deadline_${stage}`,
		subjectType: 'development_deadline',
		event: 'development.deadline_due' as const,
		async due(now: Date) {
			const today = clubToday(now);
			const [start, end] = [addIsoDays(today, from), addIsoDays(today, until)];
			const deadlines = await listDevelopmentDeadlinesBetween(start, end, {
				grants: true,
				sponsors: true
			});
			return deadlines.map(({ subjectId, ...d }) => ({
				subjectId: `${d.module}:${subjectId}:${d.on}`,
				payload: { stage, ...d }
			}));
		}
	});
}

/**
 * One stage of the radio attestation reminders (#1516): every on-air release
 * whose attestation lapses between `from` and `until` days from now. The subject
 * carries when it was given, so next year's attestation is reminded afresh.
 */
function radioAttestationExpiry(stage: '30d' | '7d', from: number, until: number) {
	return defineReminder({
		key: `radio_attestation_${stage}`,
		subjectType: 'radio_attestation',
		event: 'audio.radio_attestation_due' as const,
		async due(now: Date) {
			const rows = await listRadioAttestationsExpiringBetween(
				new Date(now.getTime() + from * DAY),
				new Date(now.getTime() + until * DAY)
			);
			return rows.map((r) => ({
				subjectId: `${r.releaseId}:${r.attestedAt.toISOString()}`,
				payload: {
					stage,
					releaseId: r.releaseId,
					releaseTitle: r.releaseTitle,
					bandName: r.bandName,
					bandSlug: r.bandSlug,
					expiresOn: clubToday(r.expiresAt),
					bandAdmins: r.bandAdmins
				}
			}));
		}
	});
}

/**
 * One stage of the renewal reminders (#1478): every renewal expiring between
 * `from` and `until` days from today. The subject carries the date, so a
 * renewal moved forward is owed its reminders again.
 */
function renewalExpiry(stage: '60d' | '14d', from: number, until: number) {
	return defineReminder({
		key: `renewal_expiry_${stage}`,
		subjectType: 'renewal',
		event: 'renewal.expiry_due' as const,
		async due(now: Date) {
			const today = clubToday(now);
			const rows = await listRenewalsExpiringBetween(
				addIsoDays(today, from),
				addIsoDays(today, until)
			);
			return rows.map((r) => ({
				subjectId: `${r.id}:${r.expiresOn}`,
				payload: {
					stage,
					renewalId: r.id,
					name: r.name,
					kind: r.kind,
					issuer: r.issuer,
					reference: r.reference,
					expiresOn: r.expiresOn,
					responsible:
						r.responsibleUserId && r.responsibleEmail
							? {
									id: r.responsibleUserId,
									name: r.responsibleName ?? '',
									email: r.responsibleEmail
								}
							: null
				}
			}));
		}
	});
}

/**
 * Reservations owed a reminder, by status and how far ahead they start.
 *
 * A show's room is excluded from the confirmation ones: staff-held,
 * with no member confirm/pay flow to nag about.
 */
async function reservationsStartingWithin(
	status: 'scheduled' | 'confirmed',
	ms: number,
	now: Date
) {
	return db
		.select({
			id: reservation.id,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt,
			userId: reservation.createdByUserId,
			userName: user.name,
			userEmail: user.email
		})
		.from(reservation)
		.innerJoin(user, eq(user.id, reservation.createdByUserId))
		.where(
			and(
				eq(reservation.status, status),
				...(status === 'scheduled' ? [ne(reservation.bookerType, 'production')] : []),
				gte(reservation.startsAt, now),
				lt(reservation.startsAt, new Date(now.getTime() + ms))
			)
		)
		.limit(500);
}

const when = (row: { startsAt: Date; endsAt: Date }) => ({
	date: formatDateFull(row.startsAt, TZ),
	startTime: formatTimeSimple(row.startsAt, TZ),
	endTime: formatTimeSimple(row.endsAt, TZ)
});

/**
 * Every reminder the app sends, as anchor plus offset.
 *
 * Adding one is an entry here. It used to be a route file, a `schedule.ts`
 * entry, an `ALL_ENDPOINTS` entry, a service query and a fresh argument about
 * why the job fires once — and that last one is what #1123 was.
 */
export const reminders: ReminderDefinition[] = [
	// Two stages over one subject, so they carry different keys and each is sent
	// once. Before the mark they had to be non-overlapping bands on a job that
	// ran exactly daily, which is the constraint that made #1123 unfixable.
	defineReminder({
		key: 'reservation_confirmation_window_open',
		subjectType: 'reservation',
		event: 'reservation.confirmation_reminder_due',
		async due(now) {
			const rows = await reservationsStartingWithin(
				'scheduled',
				CONFIRMATION_WINDOW_DAYS * DAY,
				now
			);
			return rows.map((row) => ({
				subjectId: row.id,
				payload: {
					stage: 'window_open' as const,
					reservationId: row.id,
					userId: row.userId,
					userName: row.userName,
					userEmail: row.userEmail,
					...when(row)
				}
			}));
		}
	}),

	defineReminder({
		key: 'reservation_confirmation_final',
		subjectType: 'reservation',
		event: 'reservation.confirmation_reminder_due',
		async due(now) {
			const rows = await reservationsStartingWithin('scheduled', DAY, now);
			return rows.map((row) => ({
				subjectId: row.id,
				payload: {
					stage: 'final' as const,
					reservationId: row.id,
					userId: row.userId,
					userName: row.userName,
					userEmail: row.userEmail,
					...when(row)
				}
			}));
		}
	}),

	defineReminder({
		key: 'reservation_reminder',
		subjectType: 'reservation',
		event: 'reservation.reminder_due',
		async due(now) {
			const rows = await reservationsStartingWithin('confirmed', DAY, now);
			return rows.map((row) => ({
				subjectId: row.id,
				payload: {
					reservationId: row.id,
					userId: row.userId,
					userName: row.userName,
					userEmail: row.userEmail,
					...when(row)
				}
			}));
		}
	}),

	// Owed once `reconcileSyncState` stamps lockSyncedAt: a code U-tec only
	// queued may not open the door yet. The one-day floor keeps the first drain
	// from mailing every code already on the lock, and still retries a failure.
	defineReminder({
		key: 'door_code_ready',
		subjectType: 'reservation',
		event: 'reservation.door_code_ready',
		async due(now) {
			const rows = await db
				.select({
					id: reservation.id,
					lockCode: reservation.lockCode,
					startsAt: reservation.startsAt,
					endsAt: reservation.endsAt,
					userId: reservation.createdByUserId,
					userName: user.name,
					userEmail: user.email
				})
				.from(reservation)
				.innerJoin(user, eq(user.id, reservation.createdByUserId))
				.where(
					and(
						eq(reservation.status, 'confirmed'),
						isNotNull(reservation.lockCode),
						isNotNull(reservation.lockSyncedAt),
						gte(reservation.lockSyncedAt, new Date(now.getTime() - DAY)),
						gt(reservation.endsAt, now)
					)
				)
				.limit(500);
			return rows.map((row) => ({
				subjectId: row.id,
				payload: {
					reservationId: row.id,
					code: row.lockCode!,
					userId: row.userId,
					userName: row.userName,
					userEmail: row.userEmail,
					...when(row)
				}
			}));
		}
	}),

	defineReminder({
		key: 'shift_reminder',
		subjectType: 'volunteer_signup',
		event: 'volunteer.shift_reminder_due',
		async due(now) {
			const rows = await listSignupsStartingBetween(now, new Date(now.getTime() + DAY));
			return rows.map((row) => ({
				subjectId: row.signupId,
				payload: {
					signupId: row.signupId,
					shiftId: row.shiftId,
					userId: row.userId,
					userName: row.userName,
					userEmail: row.userEmail,
					roleName: row.roleName,
					title: row.title,
					eventTitle: row.eventTitle,
					startsAt: row.startsAt.toISOString(),
					endsAt: row.endsAt.toISOString()
				}
			}));
		}
	}),

	// The window stays [48h ago, 24h ago). The mark makes it belt-and-braces
	// rather than load-bearing, but widening it would ask everybody whose shift
	// the floor newly covers, in one burst, on the first run.
	defineReminder({
		key: 'shift_feedback',
		subjectType: 'volunteer_signup',
		event: 'volunteer.shift_feedback_due',
		async due(now) {
			const rows = await listCompletionsAwaitingFeedback(
				new Date(now.getTime() - 2 * DAY),
				new Date(now.getTime() - DAY)
			);
			return rows.map((row) => ({
				subjectId: row.signupId,
				payload: {
					signupId: row.signupId,
					shiftId: row.shiftId,
					userId: row.userId,
					userName: row.userName,
					userEmail: row.userEmail,
					roleName: row.roleName,
					title: row.title,
					eventTitle: row.eventTitle,
					startsAt: row.startsAt.toISOString(),
					endsAt: row.endsAt.toISOString()
				}
			}));
		}
	}),

	// The courtesy, then three nags. Four entries against one anchor rather than
	// one entry with a "reminded already" flag: the sent-mark is keyed by
	// (reminder_key, subject), so each fires once and the set is declarative —
	// the case #1186's registry exists for.
	defineReminder({
		key: 'loan_due_tomorrow',
		subjectType: 'inventory_loan',
		event: 'equipment.loan_due',
		async due(now) {
			const rows = await listLoansDueBetween(now, new Date(now.getTime() + DAY));
			return rows.map((row) => ({
				subjectId: row.loanId,
				payload: {
					stage: 'due_tomorrow' as const,
					daysLate: 0,
					loanId: row.loanId,
					userId: row.userId,
					userName: row.userName,
					userEmail: row.userEmail,
					equipmentName: row.equipmentName,
					dueDate: formatDateFull(row.dueDate, TZ)
				}
			}));
		}
	}),

	...OVERDUE_BANDS.map(overdueLoans),

	// Non-overlapping bands, so one drain sends one stage: a deadline first seen
	// inside three days gets only the last reminder. Past deadlines get none;
	// the lists show those in red.
	developmentDeadlines('14d', 4, 14),
	developmentDeadlines('3d', 0, 3),
	// Non-overlapping bands, so one drain sends one stage: a renewal first
	// entered inside two weeks gets only the last one. A lapsed one gets none;
	// the list shows it in red.
	renewalExpiry('60d', 15, 60),
	renewalExpiry('14d', 0, 14),
	// Non-overlapping, as above. A lapsed attestation gets no reminder: the
	// release is already off the air and the band's music page says so.
	radioAttestationExpiry('30d', 8, 30),
	radioAttestationExpiry('7d', 0, 7)
];
