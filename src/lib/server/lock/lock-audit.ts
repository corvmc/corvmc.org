import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.js';
import { reservation } from '#lib/server/db/schema/reservation.js';
import { user } from '#lib/server/db/schema/authentication.js';
import {
	auditEntryStatement,
	recordAuditEntry,
	type AuditActor
} from '#lib/server/audit/audit-service.js';
import { formatDateInTz, formatTimeInTz } from '#lib/server/reservation/timezone.js';
import { DEFAULT_TIMEZONE } from '#lib/config.js';
import { captureException } from '#lib/server/sentry.js';
import type { AuditEntryInput } from '#lib/types/audit.js';

/**
 * The audit trail of a booking's door code. The reservation's lock columns are
 * blanked when a booking ends or is cancelled, so these rows are the only
 * record that a code was issued, when, and what became of it.
 *
 * A row names the lock access id and never the code, which is a secret.
 */

/** The booking a row is about; the subject is the member who booked. */
export type LockAuditSlot = {
	id: string;
	startsAt: Date;
	endsAt: Date;
	createdByUserId: string;
	memberName: string | null;
};

export type LockAuditEvent =
	| { kind: 'assigned'; lockAccessId: string | null; syncedAt: Date | null }
	| { kind: 'cleared'; lockAccessId: string | null; reason: 'ended' | 'cancelled' }
	| { kind: 'failed'; stage: 'issue' | 'clear'; lockAccessId: string | null };

/** One booking's slot, or null when it is gone. */
export async function loadLockAuditSlot(reservationId: string): Promise<LockAuditSlot | null> {
	const [row] = await db
		.select({
			id: reservation.id,
			startsAt: reservation.startsAt,
			endsAt: reservation.endsAt,
			createdByUserId: reservation.createdByUserId,
			memberName: user.name
		})
		.from(reservation)
		.leftJoin(user, eq(user.id, reservation.createdByUserId))
		.where(eq(reservation.id, reservationId))
		.limit(1);
	return row ?? null;
}

/** The entry for one lifecycle event. `actor` defaults to System. */
export function lockAuditEntry(
	slot: LockAuditSlot,
	event: LockAuditEvent,
	actor?: AuditActor
): AuditEntryInput {
	const when = {
		reservationId: slot.id,
		date: formatDateInTz(slot.startsAt, DEFAULT_TIMEZONE),
		startTime: formatTimeInTz(slot.startsAt, DEFAULT_TIMEZONE),
		endTime: formatTimeInTz(slot.endsAt, DEFAULT_TIMEZONE)
	};
	const subject = { type: 'user' as const, id: slot.createdByUserId, label: slot.memberName };
	const base = { subject, actor: actor ?? { id: null, name: 'System', email: '' } };
	switch (event.kind) {
		case 'assigned':
			return {
				...base,
				action: 'reservation.door_code_assigned',
				details: {
					...when,
					lockAccessId: event.lockAccessId,
					syncedAt: event.syncedAt?.toISOString() ?? null
				}
			};
		case 'cleared':
			return {
				...base,
				action: 'reservation.door_code_cleared',
				details: { ...when, lockAccessId: event.lockAccessId, reason: event.reason }
			};
		case 'failed':
			return {
				...base,
				action: 'reservation.door_code_failed',
				details: { ...when, stage: event.stage, lockAccessId: event.lockAccessId }
			};
	}
}

/**
 * The insert for an event, to sit in the same `db.batch` as the column write it
 * records. Empty when the booking is gone or the row cannot be built: the write
 * goes ahead without it, since the door code matters more than its trail. An
 * array because an async function would await, and so run, a bare statement.
 */
export async function lockAuditStatements(
	reservationId: string,
	event: LockAuditEvent,
	actor?: AuditActor
) {
	try {
		const slot = await loadLockAuditSlot(reservationId);
		return slot ? [auditEntryStatement(lockAuditEntry(slot, event, actor))] : [];
	} catch (err) {
		captureException(err);
		return [];
	}
}

/** Record an event that changed no column, so there is nothing to batch it with. Never throws. */
export async function recordLockAudit(
	reservationId: string,
	event: LockAuditEvent,
	actor?: AuditActor
): Promise<void> {
	try {
		const slot = await loadLockAuditSlot(reservationId);
		if (slot) await recordAuditEntry(lockAuditEntry(slot, event, actor));
	} catch (err) {
		captureException(err);
	}
}
