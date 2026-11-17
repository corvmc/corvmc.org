import { and, asc, eq, gt, gte, inArray, lt, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import {
	volunteerRole,
	volunteerRoleInterest,
	volunteerShift,
	volunteerSignup,
	workOrder
} from '#lib/server/db/schema/volunteer.js';
import { eventListing } from '#lib/server/db/schema/event.js';
import { reminderSent } from '#lib/server/db/schema/reminder.js';
import { outboxMessage } from '#lib/server/db/schema/outbox.js';
import { emailRow } from '#lib/server/outbox/outbox-row.js';
import { deliverSoon } from '#lib/server/outbox/outbox-service.js';
import { chunkInsert } from '#lib/server/utils/chunk.js';
import { standaloneEmail } from '#lib/server/notification/dispatcher.js';
import { createNotifications } from '#lib/server/notification/in-app-service.js';
import { listBatchRecipients } from '#lib/server/notification/recipient.js';
import { captureException } from '#lib/server/sentry.js';
import { formatDateLong, formatTime } from '#lib/utils/format.js';
import { shiftLabel } from '#lib/utils/shift-label.js';
import { liveShift, notOnCancelledListing, openTask, shiftClaimedSql } from './work-order-service';

/**
 * Emailing members when a shift opens in a role they picked (#3239).
 *
 * Derived, not raised: every path that inserts a shift (the schedule form, a
 * duty list, copy-forward, a production's host shift, orientations) is caught
 * by reading new rows, so none of them owes a hook. `reminder_sent` is the
 * latch, written in the same `db.batch` as the outbox rows, so a shift is
 * announced once or not at all; a second pass racing this one fails on its
 * unique index and sends nothing.
 *
 * One email per member per pass, listing every new shift in their roles, so a
 * duty list stamping eight shifts is one email, not eight. The whole send is a
 * handful of statements, inside the Worker's subrequest limit.
 */

export const SHIFT_OPENED_KEY = 'shift_opened';
export const SHIFT_OPENED_TYPE = 'volunteer_shift_opened';

/**
 * How far back a pass looks. Shifts older than this were open before the
 * feature existed or were missed for a day, and an email about them is no
 * longer news.
 */
const LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** D1 caps a statement at 100 bound parameters. */
const IN_CHUNK = 90;

export interface NewOpenShift {
	shiftId: string;
	volunteerRoleId: string;
	roleName: string;
	title: string | null;
	eventTitle: string | null;
	startsAt: Date;
	endsAt: Date;
	createdByUserId: string | null;
}

/** Shifts created in the lookback, still open to sign-ups, not yet announced. */
export async function listNewOpenShifts(now: Date): Promise<NewOpenShift[]> {
	return db
		.select({
			shiftId: volunteerShift.id,
			volunteerRoleId: volunteerRole.id,
			roleName: volunteerRole.name,
			title: workOrder.title,
			eventTitle: eventListing.title,
			startsAt: volunteerShift.startsAt,
			endsAt: volunteerShift.endsAt,
			createdByUserId: volunteerShift.createdByUserId
		})
		.from(volunteerShift)
		.innerJoin(workOrder, eq(workOrder.id, volunteerShift.workOrderId))
		.innerJoin(volunteerRole, eq(volunteerRole.id, workOrder.volunteerRoleId))
		.leftJoin(eventListing, eq(eventListing.id, workOrder.eventId))
		.where(
			and(
				liveShift(),
				openTask(),
				notOnCancelledListing(),
				eq(volunteerRole.isActive, true),
				gt(volunteerShift.startsAt, now),
				gte(volunteerShift.createdAt, new Date(now.getTime() - LOOKBACK_MS)),
				lt(shiftClaimedSql(), volunteerShift.capacity),
				sql`not exists (
					select 1 from ${reminderSent} rs
					where rs."reminder_key" = ${SHIFT_OPENED_KEY} and rs."subject_id" = ${volunteerShift.id}
				)`
			)
		)
		.orderBy(asc(volunteerShift.startsAt));
}

/** Members interested in any of these roles, as role → user ids. */
async function interestedByRole(roleIds: string[]): Promise<Map<string, string[]>> {
	const out = new Map<string, string[]>();
	for (let i = 0; i < roleIds.length; i += IN_CHUNK) {
		const rows = await db
			.select({
				roleId: volunteerRoleInterest.volunteerRoleId,
				userId: volunteerRoleInterest.userId
			})
			.from(volunteerRoleInterest)
			.where(inArray(volunteerRoleInterest.volunteerRoleId, roleIds.slice(i, i + IN_CHUNK)));
		for (const r of rows) out.set(r.roleId, [...(out.get(r.roleId) ?? []), r.userId]);
	}
	return out;
}

/**
 * Who is already on, invited to, or has turned down each shift. Any signup row
 * counts, cancelled ones included: somebody who dropped a shift an hour ago
 * does not need telling it is open.
 */
async function alreadyOn(shiftIds: string[]): Promise<Set<string>> {
	const out = new Set<string>();
	for (let i = 0; i < shiftIds.length; i += IN_CHUNK) {
		const rows = await db
			.select({ shiftId: volunteerSignup.shiftId, userId: volunteerSignup.userId })
			.from(volunteerSignup)
			.where(inArray(volunteerSignup.shiftId, shiftIds.slice(i, i + IN_CHUNK)));
		for (const r of rows) out.add(`${r.shiftId}:${r.userId}`);
	}
	return out;
}

/** "Saturday, February 7, 6:00–10:00 PM". */
function when(s: NewOpenShift): string {
	return `${formatDateLong(s.startsAt)}, ${formatTime(s.startsAt)}–${formatTime(s.endsAt)}`;
}

const BOARD_HREF = '/member/volunteer';

/** One member's email: one shift by name, or several as a list. */
export function openShiftsEmail(name: string, shifts: NewOpenShift[]) {
	const [first] = shifts;
	const single = shifts.length === 1;
	return {
		recipientName: name.split(' ')[0],
		subject: single
			? `Open shift: ${shiftLabel(first)}`
			: `${shifts.length} open shifts in your roles`,
		heading: single ? 'Open shift' : 'Open shifts',
		paragraphs: [
			{
				text: single
					? `A ${first.roleName} shift opened. Sign up from your volunteering page.`
					: 'Shifts opened in roles you picked. Sign up from your volunteering page.'
			}
		],
		details: shifts.map((s) => ({ label: shiftLabel(s), value: when(s) })),
		cta: { url: BOARD_HREF, label: 'View open shifts' },
		footnote: 'Sent for the roles you picked. Change them from your volunteering page.'
	};
}

export interface AnnounceResult {
	shifts: number;
	emailed: number;
}

/**
 * Announce every new open shift to the members whose roles it is in.
 *
 * Throws on a failed write, leaving the shifts unstamped for the next pass.
 */
export async function announceOpenShifts(now: Date = new Date()): Promise<AnnounceResult> {
	const shifts = await listNewOpenShifts(now);
	if (shifts.length === 0) return { shifts: 0, emailed: 0 };

	const byRole = await interestedByRole([...new Set(shifts.map((s) => s.volunteerRoleId))]);
	const taken = await alreadyOn(shifts.map((s) => s.shiftId));

	const owed = new Map<string, NewOpenShift[]>();
	for (const s of shifts) {
		for (const userId of byRole.get(s.volunteerRoleId) ?? []) {
			if (userId === s.createdByUserId || taken.has(`${s.shiftId}:${userId}`)) continue;
			owed.set(userId, [...(owed.get(userId) ?? []), s]);
		}
	}

	const recipients = owed.size
		? await listBatchRecipients([...owed.keys()], SHIFT_OPENED_TYPE)
		: [];

	const emails = recipients
		.filter((r) => r.emailEnabled)
		.map((r) =>
			emailRow(
				standaloneEmail(SHIFT_OPENED_TYPE, r.email, openShiftsEmail(r.name, owed.get(r.userId)!))
			)
		);

	const stamps = shifts.map((s) => ({
		reminderKey: SHIFT_OPENED_KEY,
		subjectType: 'volunteer_shift',
		subjectId: s.shiftId
	}));
	await db.batch([
		...chunkInsert(stamps, (group) => db.insert(reminderSent).values(group)),
		...chunkInsert(emails, (group) => db.insert(outboxMessage).values(group))
	] as unknown as Parameters<typeof db.batch>[0]);
	if (emails.length > 0) await deliverSoon(emails.map((e) => e.id));

	// After the latch: the email is the point, and the bell row only exists for
	// a member who turned it on. A failure here costs one row, not a resend.
	const inApp = recipients.filter((r) => r.inAppEnabled);
	if (inApp.length > 0) {
		await createNotifications(
			inApp.map((r) => {
				const mine = owed.get(r.userId)!;
				return {
					userId: r.userId,
					type: SHIFT_OPENED_TYPE,
					title:
						mine.length === 1
							? `Open shift: ${shiftLabel(mine[0])}`
							: `${mine.length} open shifts in your roles`,
					body: mine.length === 1 ? when(mine[0]) : undefined,
					href: BOARD_HREF
				};
			})
		).catch((err) => captureException(err, { event: 'volunteer.shift_opened', channel: 'in-app' }));
	}

	return { shifts: shifts.length, emailed: emails.length };
}
