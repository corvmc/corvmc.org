/**
 * The staff audit log's vocabulary: which actions are recorded and what each
 * one's `details` payload carries. Imported by the schema, the service and the
 * display helper, so it lives outside `$lib/server` and must be imported by
 * relative path from the schema (`pnpm db:generate` has no alias map).
 *
 * A key is only listed once something writes it.
 */
export const auditActions = [
	'reservation.cancelled_by_staff',
	'band.deactivated',
	'band.reactivated',
	'user.roles_changed',
	'user.profile_updated',
	'user.deactivated',
	'user.reactivated',
	'user.purged',
	'user.banned',
	'user.unbanned',
	'user.email_change_requested',
	'user.email_changed',
	'credits.adjusted',
	'incident.deleted'
] as const;
export type AuditAction = (typeof auditActions)[number];

export const auditSubjectTypes = ['user', 'band', 'incident'] as const;
export type AuditSubjectType = (typeof auditSubjectTypes)[number];

/** Profile field names only — never values, which would copy phone numbers into a second table. */
export type AuditProfileField = 'name' | 'pronouns' | 'phone' | 'dateOfBirth';

export interface AuditDetailsByAction {
	/** The subject is the member who booked. Date and times are pre-formatted in the space's zone. */
	'reservation.cancelled_by_staff': {
		reservationId: string;
		reason: string | null;
		date: string;
		startTime: string;
		endTime: string;
	};
	'band.deactivated': { bandId: string; bandName: string };
	'band.reactivated': { bandId: string; bandName: string };
	'user.roles_changed': { added: string[]; removed: string[] };
	'user.profile_updated': { fields: AuditProfileField[] };
	'user.deactivated': {
		reservationsCancelled: number;
		subscriptionCancelled: boolean;
		bulk: boolean;
		/** Shared by every row one bulk deactivation wrote. */
		batchId?: string;
	};
	'user.reactivated': { subscription: 'resumed' | 'active' | 'lapsed' | 'none' };
	'user.purged': { name: string; email: string };
	/** A ban also writes `user.deactivated`, which carries what the offboarding took. */
	'user.banned': { reason: string };
	'user.unbanned': Record<string, never>;
	/** Written by the staffer who proposed it; the address is not the login until confirmed. */
	'user.email_change_requested': { email: string };
	/** The actor is the member, who confirmed from the new mailbox. Kept so staff can reverse it. */
	'user.email_changed': { previousEmail: string; newEmail: string };
	'credits.adjusted': {
		creditType: 'free_hours' | 'equipment_credits';
		delta: number;
		balanceAfter: number;
		description: string;
	};
	/** The retention sweep's deletion (#1468). The row is gone, so this is the record it existed. */
	'incident.deleted': { category: string; occurredAt: string; retentionYears: number };
}

/** One row as the read side sees it, `details` narrowed by `action`. */
export type AuditEntry = {
	[A in AuditAction]: {
		id: string;
		action: A;
		actorUserId: string | null;
		actorName: string;
		actorEmail: string;
		subjectType: AuditSubjectType;
		subjectId: string;
		subjectLabel: string | null;
		details: AuditDetailsByAction[A];
		createdAt: Date;
	};
}[AuditAction];

export interface AuditActor {
	id: string | null;
	name: string;
	email: string;
}

export type AuditEntryInput = {
	[A in AuditAction]: {
		action: A;
		subject: { type: AuditSubjectType; id: string; label?: string | null };
		details: AuditDetailsByAction[A];
		/** Defaults to the signed-in user, or "System" when there is none. */
		actor?: AuditActor;
	};
}[AuditAction];
