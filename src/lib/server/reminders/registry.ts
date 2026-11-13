import { db } from '#lib/server/db/index.js';
import { reservation } from '#lib/server/db/schema/reservation.js';
import { user } from '#lib/server/db/schema/authentication.js';
import { reminderSent } from '#lib/server/db/schema/reminder.js';
import { eq, and, gt, gte, lt, isNotNull, ne, or, sql } from 'drizzle-orm';
import {
	formatDateFull,
	formatDateInTz,
	formatTimeInTz,
	formatTimeSimple
} from '#lib/server/reservation/timezone.js';
import {
	CLASSIFIED_EXPIRY_REMINDER_DAYS,
	DEFAULT_TIMEZONE,
	clubToday,
	fundingProjectKinds,
	surfaces,
	type ProjectKind
} from '#lib/config.js';
import type { DeliverableDueItem } from '#lib/server/event-bus/event-bus.js';
import { addIsoDays } from '#lib/utils/deadline.js';
import { listDevelopmentDeadlinesBetween } from '#lib/server/development/deadline-service.js';
import {
	listSignupsStartingBetween,
	listCompletionsAwaitingFeedback
} from '#lib/server/volunteer/volunteer-signup-service.js';
import { listLoansDueBetween } from '#lib/server/inventory/loan-service.js';
import { listRadioAttestationsExpiringBetween } from '#lib/server/audio/radio-attestation.js';
import { listDeliverablesDueBetween } from '#lib/server/volunteer/deliverables-service.js';
import {
	listFirstVisitsBetween,
	listUnclaimedOrientationsBetween
} from '#lib/server/volunteer/orientation-reminders.js';
import { holdsPracticeSpaceClearanceSql } from '#lib/server/volunteer/practice-space-clearance.js';
import { membersOwingFees } from '#lib/server/reservation/outstanding-fees.js';
import { listUsersWithCapability } from '#lib/server/authorization.js';
import { listPostsExpiringBetween } from '#lib/server/classified/classified-service.js';
import { config } from '#lib/server/site-config/site-config-service.js';
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
 * One stage of a committee's work (#1709): open items due between `from` and
 * `until` days from now, done ones dropped, on projects of `projectKinds` when
 * given. The subject carries the due date, so an item whose date moves is owed
 * its reminders again. A digest: every stage reaches each person as one mail
 * per pass (#2507).
 */
function deliverablesDue(
	stage: DeliverableDueItem['stage'],
	from: number,
	until: number,
	projectKinds?: readonly ProjectKind[]
) {
	return defineReminder({
		key: stage === 'overdue' ? 'deliverable_overdue' : `deliverable_${stage}`,
		subjectType: 'work_order',
		event: 'volunteer.deliverable_due' as const,
		digest: true,
		async due(now: Date) {
			const rows = await listDeliverablesDueBetween(
				new Date(now.getTime() + from * DAY),
				new Date(now.getTime() + until * DAY),
				projectKinds ? { projectKinds } : {}
			);
			return rows
				.filter((r) => r.recipients.length > 0)
				.map((r) => ({
					subjectId: `${r.id}:${r.dueAt.toISOString()}`,
					recipients: r.recipients,
					item: {
						stage,
						workOrderId: r.id,
						title: r.title,
						eventTitle: r.eventTitle,
						projectName: r.projectName,
						dueAt: r.dueAt.toISOString(),
						groupName: r.groupName,
						groupSlug: r.groupSlug
					}
				}));
		}
	});
}

const FIRST_VISIT = 'first_visit';

/** What every first-visit mail says about the place: its address and staff notes. */
async function firstVisitSettings() {
	const [street, city, notes] = await Promise.all([
		config('org.addressStreet'),
		config('org.addressCity'),
		config('volunteer.firstVisitNotes')
	]);
	return {
		address: [street, city]
			.map((v) => String(v).trim())
			.filter(Boolean)
			.join(', '),
		notes: String(notes).trim()
	};
}

/**
 * Confirmed reservations starting within `ms` of `now`, less first visits:
 * those get `first_visit` instead. A booking already sent that one stays out
 * after a clearance lands, so the member gets one mail, not two.
 */
async function reservationsStartingWithin(ms: number, now: Date) {
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
				eq(reservation.status, 'confirmed'),
				gte(reservation.startsAt, now),
				lt(reservation.startsAt, new Date(now.getTime() + ms)),
				or(
					ne(reservation.bookerType, 'user'),
					holdsPracticeSpaceClearanceSql(reservation.createdByUserId, now)
				),
				sql`not exists (select 1 from ${reminderSent} where ${reminderSent.reminderKey} = ${FIRST_VISIT} and ${reminderSent.subjectId} = ${reservation.id})`
			)
		)
		.limit(500);
}

const when = (row: { startsAt: Date; endsAt: Date }) => ({
	date: formatDateInTz(row.startsAt, TZ),
	startTime: formatTimeInTz(row.startsAt, TZ),
	endTime: formatTimeInTz(row.endsAt, TZ)
});

/**
 * Every reminder the app sends, as anchor plus offset.
 *
 * Adding one is an entry here. It used to be a route file, a `schedule.ts`
 * entry, an `ALL_ENDPOINTS` entry, a service query and a fresh argument about
 * why the job fires once — and that last one is what #1123 was.
 */
export const reminders: ReminderDefinition[] = [
	defineReminder({
		key: 'reservation_reminder',
		subjectType: 'reservation',
		event: 'reservation.reminder_due',
		async due(now) {
			const rows = await reservationsStartingWithin(DAY, now);
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

	// A member's visit before they hold the Practice space clearance (#2569).
	defineReminder({
		key: FIRST_VISIT,
		subjectType: 'reservation',
		event: 'reservation.first_visit_due',
		async due(now) {
			const rows = await listFirstVisitsBetween(now, new Date(now.getTime() + DAY), now);
			if (rows.length === 0) return [];
			const { address, notes } = await firstVisitSettings();
			return rows.map((row) => ({
				subjectId: row.id,
				payload: {
					reservationId: row.id,
					userId: row.userId,
					userName: row.userName,
					userEmail: row.userEmail,
					...when(row),
					tourTime: row.tourStartsAt ? formatTimeSimple(row.tourStartsAt, TZ) : null,
					address,
					notes
				}
			}));
		}
	}),

	// An orientation shift nobody has signed up for, a day out (#2567). A digest,
	// so two on one day reach each coordinator as one mail. The subject carries
	// the start, so a shift moved to another day is owed the alert again.
	defineReminder({
		key: 'orientation_unclaimed',
		subjectType: 'work_order',
		event: 'volunteer.orientation_unclaimed',
		digest: true,
		async due(now) {
			const rows = await listUnclaimedOrientationsBetween(now, new Date(now.getTime() + DAY));
			if (rows.length === 0) return [];
			const staff = await listUsersWithCapability('volunteer.manageShifts');
			if (staff.length === 0) return [];
			const recipients = staff.map((s) => ({
				userId: s.id,
				userName: s.name,
				userEmail: s.email
			}));
			return rows.map((r) => ({
				subjectId: `${r.workOrderId}:${r.startsAt.toISOString()}`,
				recipients,
				item: {
					workOrderId: r.workOrderId,
					memberName: r.memberName,
					startsAt: r.startsAt.toISOString(),
					endsAt: r.endsAt.toISOString()
				}
			}));
		}
	}),

	// Owed once `reconcileSyncState` stamps lockSyncedAt: a code U-tec only
	// queued may not open the door yet. The one-day floor keeps the first drain
	// from mailing every code already on the lock; a booking starting within a
	// day stays owed past it. Withheld while the member owes a fee (#2859): no
	// sent-mark, so the first drain after payment sends it.
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
						or(
							gte(reservation.lockSyncedAt, new Date(now.getTime() - DAY)),
							lt(reservation.startsAt, new Date(now.getTime() + DAY))
						),
						gt(reservation.endsAt, now)
					)
				)
				.limit(500);
			const owing = await membersOwingFees(
				rows.map((r) => r.userId),
				now
			);
			return rows
				.filter((row) => !owing.has(row.userId))
				.map((row) => ({
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
					workOrderId: row.workOrderId,
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
					workOrderId: row.workOrderId,
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
	// Non-overlapping, as above. A lapsed attestation gets no reminder: the
	// release is already off the air and the band's music page says so.
	radioAttestationExpiry('30d', 8, 30),
	radioAttestationExpiry('7d', 0, 7),
	// Non-overlapping: due in the next three days, then late by one to fourteen.
	// Past a fortnight late it gets no more; the committee's queue shows it red.
	// A grant report needs more warning than a show item (#2622).
	deliverablesDue('due_14d', 4, 14, fundingProjectKinds),
	deliverablesDue('due_3d', 0, 3),
	deliverablesDue('overdue', -14, -1),

	// A classified post about to leave the board (#2549). The subject carries the
	// expiry, so a renewed post is owed the reminder again next time round.
	// Nothing goes out while the surface is off: the link would 404.
	defineReminder({
		key: 'classified_expiring',
		subjectType: 'classified_post',
		event: 'classified.expiring',
		async due(now) {
			if (!surfaces.classifieds) return [];
			const rows = await listPostsExpiringBetween(
				now,
				new Date(now.getTime() + CLASSIFIED_EXPIRY_REMINDER_DAYS * DAY)
			);
			return rows.map((r) => ({
				subjectId: `${r.id}:${r.expiresAt.toISOString()}`,
				payload: {
					postId: r.id,
					title: r.title,
					expiresOn: formatDateFull(r.expiresAt, TZ),
					userId: r.userId,
					userName: r.userName,
					userEmail: r.userEmail
				}
			}));
		}
	})
];
