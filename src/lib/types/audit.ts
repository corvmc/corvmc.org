/**
 * The staff audit log's vocabulary: which actions are recorded and what each
 * one's `details` payload carries. Imported by the schema, the service and the
 * display helper, so it lives outside `$lib/server` and must be imported by
 * relative path from the schema (`pnpm db:generate` has no alias map).
 *
 * A key is only listed once something writes it.
 */
export const auditActions = [
	'user.roles_changed',
	'user.profile_updated',
	'user.deactivated',
	'user.reactivated',
	'user.purged',
	'credits.adjusted'
] as const;
export type AuditAction = (typeof auditActions)[number];

export const auditSubjectTypes = ['user'] as const;
export type AuditSubjectType = (typeof auditSubjectTypes)[number];

/** Profile field names only — never values, which would copy phone numbers into a second table. */
export type AuditProfileField = 'name' | 'pronouns' | 'phone' | 'dateOfBirth';

export interface AuditDetailsByAction {
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
