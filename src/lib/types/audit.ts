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
	'reservation.comped',
	'reservation.refunded',
	'reservation.payment_reminder',
	'clearance.granted',
	'clearance.revoked',
	'orientation.waived',
	'settings.changed',
	'event.visibility_changed',
	'contact.deleted',
	'organization.deleted',
	'band.deactivated',
	'band.reactivated',
	'user.roles_changed',
	'user.profile_updated',
	'user.deactivated',
	'user.reactivated',
	'user.purged',
	'user.banned',
	'user.unbanned',
	'user.suspended',
	'user.suspension_lifted',
	'blocklist.added',
	'blocklist.removed',
	'user.email_change_requested',
	'user.email_changed',
	'user.impersonation_started',
	'user.impersonation_stopped',
	'user.impersonated_write',
	'credits.adjusted',
	'incident.deleted',
	'incident.reopened',
	'incident.retention_changed',
	'capability.grants_changed',
	'ballot.elector_overridden',
	'group.roster_imported',
	'group.role_changed',
	'production.status_changed',
	'production.override',
	'production.reopened',
	'production.payout_recorded',
	'production.payout_undone',
	'production.door_recounted',
	'event.published_over_warnings',
	'event.emailed_beyond_visibility',
	'event.edited_while_cancelled',
	'work_order.created',
	'work_order.assigned',
	'work_order.member_assigned',
	'work_order.assigned_over_warnings',
	'work_order.member_unassigned',
	'work_order.rescheduled',
	'work_order.resolved',
	'work_order.reopened',
	'work_order.cancelled',
	'work_order.moved',
	'work_order.edited',
	'work_order.member_invited',
	'work_order.dependency_added',
	'work_order.dependency_removed',
	'contractor_job.status_changed',
	'contractor_job.invoice_recorded',
	'contractor_job.reopened',
	'purchase_order.reopened',
	'inventory_asset.reopened',
	'equipment_loan.checked_out_unscheduled',
	'kit_loan.checked_out_incomplete',
	'kit_loan.returned_incomplete',
	'project.edited',
	'project.status_changed',
	'project.duty_list_applied',
	'project.section_created',
	'project.section_renamed',
	'project.section_deleted',
	'volunteer_hours.approved_over_return',
	'organization.merged',
	'contact.merged',
	'event.tickets_comped',
	'event.door_cash_sale',
	'music_purchase.refunded',
	'production.expense_removed',
	'classified.visibility_changed',
	'suggestion.visibility_changed',
	'group.visibility_changed',
	'grant.deleted',
	'sponsorship.deleted',
	'suggestion.merged',
	'role.deleted',
	'clearance.deleted',
	'venue.deleted',
	'closure.deleted',
	'audience.subscriber_removed',
	'band.member_removed',
	'gift.recorded'
] as const;
export type AuditAction = (typeof auditActions)[number];

export const auditSubjectTypes = [
	'user',
	'band',
	'incident',
	'role',
	'group',
	'production',
	'event',
	'work_order',
	'project',
	'purchase_order',
	'inventory_asset',
	'organization',
	'contact',
	'email_blocklist',
	'setting',
	'classified',
	'suggestion',
	'clearance',
	'venue'
] as const;
export type AuditSubjectType = (typeof auditSubjectTypes)[number];

/** One field a write changed, as `audited` records it: `null` where the record did not exist. */
export type AuditFieldChange = {
	key: string;
	from: string | number | boolean | null;
	to: string | number | boolean | null;
};

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
	/** The subject is the member who booked. `waivedCents` is the cash due set aside. */
	'reservation.comped': ReservationWhen & { waivedCents: number };
	/** The subject is the member who booked. `cancelled` when the refund also cancelled it. */
	'reservation.refunded': ReservationWhen & { cancelled: boolean; reason: string | null };
	/**
	 * The subject is the member who booked; the actor is System. Every attempt is
	 * a row (#2876): `sent` is in the outbox as `outboxId`; `skipped` is an account
	 * removed, the only reason a mandatory reminder sends none (#2981).
	 */
	'reservation.payment_reminder': ReservationWhen & {
		daysAfter: number;
		amountCents: number | null;
		outcome: 'sent' | 'skipped' | 'failed';
		reason: 'undeliverable' | null;
		outboxId: string | null;
	};
	/** The subject is the member. Dates are `YYYY-MM-DD` in club time. */
	'clearance.granted': ClearanceRef & { grantedOn: string; expiresOn: string | null };
	'clearance.revoked': ClearanceRef & { reason: string };
	/** The subject is the member. */
	'orientation.waived': { reason: string };
	/** One save. A secret's key is listed with no values (`redacted`). */
	'settings.changed': {
		changes: { key: string; from?: string | number | boolean; to?: string | number | boolean }[];
		redacted?: string[];
	};
	'event.visibility_changed': { from: string; to: string };
	/** The subject label is the deleted person's name. */
	'contact.deleted': { organizationId: string | null };
	/** The subject label is the deleted organization's name. */
	'organization.deleted': Record<string, never>;
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
	/** Both are stripped once the row is past the 24-month retention window (#1376). */
	'user.purged': { name?: string; email?: string };
	/** A ban also writes `user.deactivated`, which carries what the offboarding took. */
	'user.banned': { reason: string };
	'user.unbanned': Record<string, never>;
	/** `endsAt` is an ISO timestamp. A suspension also writes `user.deactivated`. */
	'user.suspended': { reason: string; endsAt: string };
	'user.suspension_lifted': { liftReason: 'appeal_granted' | 'term_lapsed' | 'staff_lifted' };
	/** The subject label is the address; the id is the blocklist entry. */
	'blocklist.added': Record<string, never>;
	'blocklist.removed': Record<string, never>;
	/** Written by the staffer who proposed it; the address is not the login until confirmed. */
	'user.email_change_requested': { email: string };
	/** The actor is the member, who confirmed from the new mailbox. Kept so staff can reverse it. */
	'user.email_changed': { previousEmail: string; newEmail: string };
	/** The actor is the admin, the subject the member they view the app as (#2847). */
	'user.impersonation_started': Record<string, never>;
	'user.impersonation_stopped': Record<string, never>;
	/** A request that could write, made while viewing as the member: what it hit and how it ended. */
	'user.impersonated_write': { method: string; path: string; status: number };
	'credits.adjusted': {
		creditType: 'free_hours' | 'equipment_credits';
		delta: number;
		balanceAfter: number;
		description: string;
	};
	/** The retention sweep's deletion (#1468). The row is gone, so this is the record it existed. */
	/** The subject survived; `mergedName` is the record folded into it and deleted. */
	'organization.merged': { mergedId: string; mergedName: string };
	/** Names only, never an address or a number. */
	'contact.merged': { mergedId: string; mergedName?: string | null };
	'incident.deleted': { category: string; occurredAt: string; retentionYears: number };
	/** The resolution set aside, null when there was none. Kept as long as the incident is. */
	'incident.reopened': { previousResolution: string | null };
	/** The retention hold set (`retain`) or released, and why. Kept as long as the incident is. */
	'incident.retention_changed': { retain: boolean; reason: string };
	/** A volunteer role's (`role`) or a committee's (`group`) grant list was edited. */
	'capability.grants_changed': {
		added: string[];
		removed: string[];
		/** A role's lead time, when it changed (#2993). */
		leadDays?: { from: number; to: number };
	};
	/** The subject is the member put on or taken off a member-wide ballot's roll. */
	'ballot.elector_overridden': {
		ballotId: string;
		ballotTitle: string;
		include: boolean;
		reason: string;
	};
	/** Counts only: the addresses themselves stay out of the log. */
	'group.roster_imported': {
		added: number;
		invited: number;
		alreadyMembers: number;
		alreadyInvited: number;
		invalid: number;
	};
	/** Staff making a program member a chair (`admin`) or not; `added` when they joined by it. */
	'group.role_changed': {
		userId: string;
		memberName: string;
		role: 'admin' | 'member';
		added: boolean;
	};
	/** The usual path: a move that tripped no warning. */
	'production.status_changed': ProductionMove;
	/** A move made over its warnings (docs/development/conventions.md#workflow-gates). */
	'production.override': ProductionMove & { warnings: string[]; reason: string };
	/** Out of a terminal state, by an admin. */
	'production.reopened': ProductionMove & { reason: string };
	'production.payout_recorded': ProductionPayout;
	'production.payout_undone': ProductionPayout;
	/** A second person counted the drawer (#2722). The two differ when the count is off. */
	'production.door_recounted': { firstCents: number; secondCents: number };
	/** A CMC listing published over its readiness warnings (#1787). */
	'event.published_over_warnings': { warnings: string[]; reason: string };
	/** A campaign about a non-public event, sent or scheduled to audiences that reach past it. */
	'event.emailed_beyond_visibility': {
		campaignId: string;
		subject: string;
		visibility: 'members' | 'group';
		audiences: string[];
		scheduled: boolean;
	};
	/** The subject is the volunteer. A returned log approved anyway (#2233). `workedOn` is YYYY-MM-DD. */
	'volunteer_hours.approved_over_return': {
		logId: string;
		workedOn: string;
		minutes: number;
		warnings: string[];
		reason: string;
	};
	/** A staff edit to a listing that stays cancelled (#2126). Field names only. */
	'event.edited_while_cancelled': { fields: EventEditField[] };
	'work_order.created': { projectId: string | null; title: string };
	/**
	 * Who answers it changed. `cancelledSignups` counts people taken off by the
	 * switch; `calledOff` names a contractor whose engagement it cancelled.
	 */
	'work_order.assigned': {
		from: WorkOrderAssignmentMode;
		to: WorkOrderAssignmentMode;
		cancelledSignups: number;
		calledOff?: string;
	};
	'work_order.member_assigned': { userId: string; memberName: string };
	/** Staff put somebody on it without a volunteer profile or a clearance its role needs. */
	'work_order.assigned_over_warnings': { userId: string; memberName: string; warnings: string[] };
	'work_order.member_unassigned': { userId: string; memberName: string };
	'work_order.rescheduled': { from: WorkOrderTiming; to: WorkOrderTiming };
	/**
	 * `override` when the task has a done condition and was ticked by hand regardless;
	 * `openBlockers` when it was marked done while tasks it waits on were open (#2625).
	 */
	'work_order.resolved': { override: boolean; reason: string | null; openBlockers?: number };
	/** The task it now waits on, or no longer does (#2625). */
	'work_order.dependency_added': { dependsOnId: string; dependsOnLabel: string };
	'work_order.dependency_removed': { dependsOnId: string; dependsOnLabel: string };
	'work_order.reopened': Record<string, never>;
	'work_order.cancelled': Record<string, never>;
	/** Section ids; null is the unlabelled group. */
	'work_order.moved': { fromSectionId: string | null; toSectionId: string | null };
	/** Field names only, as `user.profile_updated` keeps them; a change of time is `.rescheduled`. */
	'work_order.edited': { fields: WorkOrderField[] };
	'work_order.member_invited': { userId: string; memberName: string };
	/** An engagement, on its work order's log. `from` is null when the contractor was first asked. */
	'contractor_job.status_changed': {
		engagementId: string;
		contractorName: string;
		from: ContractorJobStatus | null;
		to: ContractorJobStatus;
		scheduledFor?: string | null;
	};
	'contractor_job.invoice_recorded': {
		engagementId: string;
		contractorName: string;
		costCents: number | null;
		invoiceRef: string | null;
	};
	/** Out of a terminal status, by an admin (#2259). On the work order's log, as every engagement step is. */
	'contractor_job.reopened': {
		engagementId: string;
		contractorName: string;
		from: ContractorJobStatus;
		to: ContractorJobStatus;
		reason: string;
	};
	/** Out of `received` or `cancelled`, by an admin (#2259). */
	'purchase_order.reopened': { from: string; to: string; reason: string };
	/** Out of `retired` or `lost`, by an admin (#2259). `retiredReason` is the note being set aside. */
	'inventory_asset.reopened': {
		from: string;
		to: string;
		reason: string;
		retiredReason: string | null;
		stockAdjusted: number;
	};
	/** The subject is the borrower. A requested loan checked out without scheduling it (#2234). */
	'equipment_loan.checked_out_unscheduled': {
		loanId: string;
		equipmentName: string | null;
		warnings: string[];
		reason: string;
	};
	/** The subject is the borrower. Units in the location that did not go out, and why (#2725). */
	'kit_loan.checked_out_incomplete': {
		kitLoanId: string;
		locationName: string;
		leftBehind: string[];
	};
	/** The subject is the borrower. Units still out after a kit came back (#2725). */
	'kit_loan.returned_incomplete': { kitLoanId: string; locationName: string; missing: string[] };
	'project.edited': { fields: ProjectField[] };
	/** `suggestionMoved` when the suggestion it answers moved with it. */
	'project.status_changed': { from: string; to: string; suggestionMoved: boolean };
	/** `reappliedReason` when the template had already been applied here. */
	'project.duty_list_applied': {
		dutyListId: string;
		dutyListName: string;
		tasks: number;
		reappliedReason?: string;
	};
	'project.section_created': { sectionId: string; name: string };
	'project.section_renamed': { sectionId: string; from: string; to: string };
	/** Its tasks moved to the unlabelled group; `tasks` counts them. */
	'project.section_deleted': { sectionId: string; name: string; tasks: number };
	/** Free tickets issued from the staff door list; `purchaseId` is the `comp-…` id they share. */
	'event.tickets_comped': { purchaseId: string; quantity: number; attendeeName: string };
	/** Cash taken at the door (#2800); `purchaseId` is the `cash-…` id the tickets share. */
	'event.door_cash_sale': { purchaseId: string; quantity: number; amountCents: number };
	/** The subject is the band. Stripe reversed the band's share and CMC's fee. */
	'music_purchase.refunded': { purchaseId: string; releaseTitle: string; amountCents: number };
	/** A cost-sheet line, as it was. A settled one is reversed in the ledger. */
	'production.expense_removed': {
		eventId: string | null;
		label: string;
		category: string;
		amountCents: number;
	};
	'classified.visibility_changed': { from: string; to: string };
	'suggestion.visibility_changed': { from: string; to: string };
	/** The program's directory listing. */
	'group.visibility_changed': { from: string; to: string };
	/** The subject is the funder; the grant and its funding project are gone. */
	'grant.deleted': { grantId: string; title: string };
	/** The subject is the sponsor; the sponsorship and its funding project are gone. */
	'sponsorship.deleted': { sponsorshipId: string; title: string; amountCents: number | null };
	/** The subject survived; its votes now include the merged suggestion's. */
	'suggestion.merged': { mergedId: string; mergedTitle: string; votesMoved: number };
	/** The subject label is the deleted volunteer role's name. */
	'role.deleted': Record<string, never>;
	/** A clearance in the catalog, which no member held. The label is its name. */
	'clearance.deleted': Record<string, never>;
	/** The subject label is the deleted venue's name. */
	'venue.deleted': Record<string, never>;
	/** The subject is the reservation settings. Times are ISO strings. */
	'closure.deleted': { closureId: string; startsAt: string; endsAt: string; reason: string };
	/** The subject is the subscriber: a member's id, else the subscriber row's. */
	'audience.subscriber_removed': { audienceId: string; audienceName: string };
	/** The subject is the band; the member row is gone, so its names are kept here. */
	'band.member_removed': { memberId: string; userId: string; memberName: string };
	/** The subject is the giver, a contact or an organization. `occurredOn` is `YYYY-MM-DD`. */
	'gift.recorded': {
		giftId: string;
		description: string;
		valueCents: number;
		occurredOn: string;
		projectId: string | null;
	};
}

/** Mirrors `contractorJobStatuses` in `$lib/config`, which the schema cannot import by alias. */
type ContractorJobStatus = 'asked' | 'declined' | 'booked' | 'completed' | 'cancelled' | 'no_show';

export type WorkOrderField = 'role' | 'title' | 'capacity' | 'notes' | 'event' | 'equipment';
export type EventEditField =
	| 'title'
	| 'description'
	| 'kind'
	| 'visibility'
	| 'tags'
	| 'location'
	| 'address'
	| 'externalTicketUrl'
	| 'venue'
	| 'times'
	| 'poster';
export type ProjectField =
	'name' | 'description' | 'committee' | 'suggestion' | 'budget' | 'parent' | 'dates';

/** How a work order is answered, derived from its rows (work-order-service `workOrderModes`). */
export type WorkOrderAssignmentMode = 'contractor' | 'open' | 'members' | 'unassigned';

/** A work order's window and deadline as ISO strings. */
interface WorkOrderTiming {
	startsAt: string | null;
	endsAt: string | null;
	dueAt: string | null;
}

/** A booking's slot, pre-formatted in the space's zone, as `reservation.cancelled_by_staff` keeps it. */
interface ReservationWhen {
	reservationId: string;
	date: string;
	startTime: string;
	endTime: string;
}

/** One held clearance: the member's row and the catalog entry it grants. */
interface ClearanceRef {
	memberCertificationId: string;
	certificationId: string;
	certificationName: string;
}

/** A show's status move. `eventId` is what the log links to; the production has no page. */
interface ProductionMove {
	eventId: string | null;
	from: string;
	to: string;
}

/** An act's payout, by slot. Amounts in cents. */
interface ProductionPayout {
	eventId: string | null;
	slotId: string;
	actName: string;
	amountCents: number;
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
