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
	'credits.adjusted'
] as const;
export type AuditAction = (typeof auditActions)[number];

export const auditSubjectTypes = ['user', 'band'] as const;
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
	'credits.adjusted': {
		creditType: 'free_hours' | 'equipment_credits';
		delta: number;
		balanceAfter: number;
		description: string;
	};
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
