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
import { dayStamp, digestWindow } from '#lib/server/reminders/daily-latch.js';
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
 * A daily email to members listing shifts opened in roles they picked (#3239,
 * #3258). It reads new rows rather than hooking each insert path, so every way
 * a shift is made is covered. `reminder_sent` holds two latches, written in the
 * same `db.batch` as the outbox rows: one per shift, so a shift is in at most
 * one digest, and one per club day, so a racing or repeated pass sends nothing.
 */

export const SHIFT_OPENED_KEY = 'shift_opened';
export const SHIFT_OPENED_TYPE = 'volunteer_shift_opened';

/** The per-day latch: `subject_id` is the club date, `sent_at` the pass's `now`. */
export const SHIFT_DIGEST_KEY = 'shift_opened_digest';

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

/** Shifts created since `since`, still open to sign-ups, not yet announced. */
export async function listNewOpenShifts(now: Date, since: Date): Promise<NewOpenShift[]> {
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
				gte(volunteerShift.createdAt, since),
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
	due: boolean;
	shifts: number;
	emailed: number;
}

/**
 * Send today's digest if it is owed: every new open shift, to the members whose
 * roles it is in. The day latch is written even when no shift is new, so a
 * shift opened after 9am waits for tomorrow's.
 *
 * Throws on a failed write, leaving the day and the shifts open for the next pass.
 */
export async function announceOpenShifts(now: Date = new Date()): Promise<AnnounceResult> {
	const window = await digestWindow(SHIFT_DIGEST_KEY, now);
	if (!window) return { due: false, shifts: 0, emailed: 0 };
	const stamp = dayStamp(SHIFT_DIGEST_KEY, window, now);

	const shifts = await listNewOpenShifts(now, window.since);
	if (shifts.length === 0) {
		await stamp;
		return { due: true, shifts: 0, emailed: 0 };
	}

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
		stamp,
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

	return { due: true, shifts: shifts.length, emailed: emails.length };
}
