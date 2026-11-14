import { auditSubjectTypes } from '#lib/types/audit.js';
import type {
	AuditAction,
	AuditSubjectType,
	AuditEntry,
	AuditProfileField,
	EventEditField,
	ProjectField,
	WorkOrderAssignmentMode,
	WorkOrderField
} from '#lib/types/audit.js';
import {
	assetStatusLabels,
	contractorJobStatusLabels,
	formatVolunteerHours,
	orderStatusLabels,
	positionLabels,
	projectStatusLabels
} from '#lib/config.js';
import {
	clubInstant,
	formatCents,
	formatDate,
	formatDateShort,
	formatDateShortYear,
	formatTime
} from '#lib/utils/format.js';
import type { FeedItem } from '#lib/types/activity.js';

type Area =
	| 'Members'
	| 'Reservations'
	| 'Events and shows'
	| 'Tasks'
	| 'Projects'
	| 'Equipment'
	| 'Programs and access'
	| 'Records and settings';

const AREAS: Area[] = [
	'Members',
	'Reservations',
	'Events and shows',
	'Tasks',
	'Projects',
	'Equipment',
	'Programs and access',
	'Records and settings'
];

/** Each action's area and its name in the log's filter. Typed, so a new action needs both. */
const ACTIONS: Record<AuditAction, [Area, string]> = {
	'user.roles_changed': ['Members', 'Positions changed'],
	'user.profile_updated': ['Members', 'Profile edited'],
	'user.deactivated': ['Members', 'Account deactivated'],
	'user.reactivated': ['Members', 'Account reactivated'],
	'user.purged': ['Members', 'Account permanently deleted'],
	'user.banned': ['Members', 'Member banned'],
	'user.unbanned': ['Members', 'Ban lifted'],
	'user.suspended': ['Members', 'Member suspended'],
	'user.suspension_lifted': ['Members', 'Suspension lifted'],
	'user.email_change_requested': ['Members', 'Email change requested'],
	'user.email_changed': ['Members', 'Login email changed'],
	'credits.adjusted': ['Members', 'Credits adjusted'],
	'blocklist.added': ['Members', 'Address blocked'],
	'blocklist.removed': ['Members', 'Address unblocked'],
	'clearance.granted': ['Members', 'Clearance granted'],
	'clearance.revoked': ['Members', 'Clearance revoked'],
	'orientation.waived': ['Members', 'Orientation waived'],
	'ballot.elector_overridden': ['Members', 'Ballot roll changed'],
	'reservation.cancelled_by_staff': ['Reservations', 'Reservation cancelled by staff'],
	'reservation.comped': ['Reservations', 'Reservation comped'],
	'reservation.refunded': ['Reservations', 'Reservation refunded'],
	'reservation.payment_reminder': ['Reservations', 'Payment reminder'],
	'event.visibility_changed': ['Events and shows', 'Event visibility changed'],
	'event.published_over_warnings': ['Events and shows', 'Event published over warnings'],
	'event.emailed_beyond_visibility': ['Events and shows', 'Event emailed past its visibility'],
	'event.edited_while_cancelled': ['Events and shows', 'Cancelled event edited'],
	'production.status_changed': ['Events and shows', 'Show moved'],
	'production.override': ['Events and shows', 'Show moved over warnings'],
	'production.reopened': ['Events and shows', 'Show reopened'],
	'production.payout_recorded': ['Events and shows', 'Payout recorded'],
	'production.payout_undone': ['Events and shows', 'Payout undone'],
	'production.door_recounted': ['Events and shows', 'Door counted again'],
	'work_order.created': ['Tasks', 'Task added'],
	'work_order.assigned': ['Tasks', 'Task assignment changed'],
	'work_order.member_assigned': ['Tasks', 'Member assigned'],
	'work_order.assigned_over_warnings': ['Tasks', 'Member assigned over warnings'],
	'work_order.member_unassigned': ['Tasks', 'Member unassigned'],
	'work_order.rescheduled': ['Tasks', 'Task rescheduled'],
	'work_order.resolved': ['Tasks', 'Task marked done'],
	'work_order.reopened': ['Tasks', 'Task reopened'],
	'work_order.cancelled': ['Tasks', 'Task called off'],
	'work_order.moved': ['Tasks', 'Task moved'],
	'work_order.edited': ['Tasks', 'Task edited'],
	'work_order.member_invited': ['Tasks', 'Member invited'],
	'work_order.dependency_added': ['Tasks', 'Task dependency added'],
	'work_order.dependency_removed': ['Tasks', 'Task dependency removed'],
	'contractor_job.status_changed': ['Tasks', 'Contractor job moved'],
	'contractor_job.invoice_recorded': ['Tasks', 'Contractor invoice recorded'],
	'contractor_job.reopened': ['Tasks', 'Contractor job reopened'],
	'volunteer_hours.approved_over_return': ['Tasks', 'Returned hours approved'],
	'project.edited': ['Projects', 'Project edited'],
	'project.status_changed': ['Projects', 'Project moved'],
	'project.duty_list_applied': ['Projects', 'Template applied'],
	'project.section_created': ['Projects', 'Section added'],
	'project.section_renamed': ['Projects', 'Section renamed'],
	'project.section_deleted': ['Projects', 'Section deleted'],
	'purchase_order.reopened': ['Equipment', 'Purchase order reopened'],
	'inventory_asset.reopened': ['Equipment', 'Equipment back in service'],
	'equipment_loan.checked_out_unscheduled': ['Equipment', 'Loan checked out unscheduled'],
	'kit_loan.checked_out_incomplete': ['Equipment', 'Kit checked out incomplete'],
	'kit_loan.returned_incomplete': ['Equipment', 'Kit checked in incomplete'],
	'band.deactivated': ['Programs and access', 'Band deactivated'],
	'band.reactivated': ['Programs and access', 'Band reactivated'],
	'group.roster_imported': ['Programs and access', 'Roster imported'],
	'group.role_changed': ['Programs and access', 'Chair changed'],
	'capability.grants_changed': ['Programs and access', 'Permissions changed'],
	'settings.changed': ['Records and settings', 'Settings changed'],
	'contact.deleted': ['Records and settings', 'Person deleted'],
	'contact.merged': ['Records and settings', 'People merged'],
	'organization.deleted': ['Records and settings', 'Organization deleted'],
	'organization.merged': ['Records and settings', 'Organizations merged'],
	'incident.deleted': ['Records and settings', 'Incident deleted'],
	'incident.reopened': ['Records and settings', 'Incident reopened'],
	'incident.retention_changed': ['Records and settings', 'Incident retention changed'],
	'event.tickets_comped': ['Events and shows', 'Tickets comped'],
	'music_purchase.refunded': ['Programs and access', 'Music purchase refunded'],
	'production.expense_removed': ['Events and shows', 'Show expense removed'],
	'classified.visibility_changed': ['Records and settings', 'Classified visibility changed'],
	'suggestion.visibility_changed': ['Projects', 'Suggestion visibility changed'],
	'group.visibility_changed': ['Programs and access', 'Program visibility changed'],
	'grant.deleted': ['Records and settings', 'Grant deleted'],
	'sponsorship.deleted': ['Records and settings', 'Sponsorship deleted'],
	'suggestion.merged': ['Projects', 'Suggestions merged'],
	'role.deleted': ['Tasks', 'Volunteer role deleted'],
	'clearance.deleted': ['Members', 'Clearance deleted'],
	'venue.deleted': ['Events and shows', 'Venue deleted'],
	'closure.deleted': ['Reservations', 'Closure deleted'],
	'audience.subscriber_removed': ['Members', 'Removed from audience'],
	'band.member_removed': ['Programs and access', 'Band member removed'],
	'gift.recorded': ['Records and settings', 'Gift recorded']
};

/** What the log's action filter calls an action. */
export function auditActionLabel(action: AuditAction): string {
	return ACTIONS[action][1];
}

/** The action filter's options: grouped by area, alphabetical within one. */
export const auditActionGroups = AREAS.map((area) => ({
	label: area,
	options: (Object.entries(ACTIONS) as [AuditAction, [Area, string]][])
		.filter(([, [a]]) => a === area)
		.map(([value, [, label]]) => ({ value, label }))
		.sort((x, y) => x.label.localeCompare(y.label))
}));

/**
 * What each kind of record is called in the log's record-type filter. A show's
 * rows file under its event, so `production` is not offered on its own.
 */
const SUBJECT_LABELS: Record<Exclude<AuditSubjectType, 'production'>, string> = {
	user: 'Member',
	band: 'Band',
	group: 'Group',
	event: 'Event',
	project: 'Project',
	work_order: 'Task',
	role: 'Volunteer role',
	incident: 'Incident',
	organization: 'Organization',
	contact: 'Contact',
	inventory_asset: 'Equipment',
	purchase_order: 'Purchase order',
	email_blocklist: 'Blocked address',
	setting: 'Setting',
	classified: 'Classified',
	suggestion: 'Suggestion',
	clearance: 'Clearance',
	venue: 'Venue'
};

/** The record types the log can filter by, labelled. */
export const auditSubjectOptions = auditSubjectTypes.flatMap((value) =>
	value === 'production' ? [] : [{ value, label: SUBJECT_LABELS[value] }]
);

const FIELD_LABELS: Record<AuditProfileField, string> = {
	name: 'name',
	pronouns: 'pronouns',
	phone: 'phone',
	dateOfBirth: 'date of birth'
};

const MODE_LABELS: Record<WorkOrderAssignmentMode, string> = {
	contractor: 'a contractor',
	open: 'open to volunteers',
	members: 'assigned members',
	unassigned: 'nobody'
};

const WORK_ORDER_FIELDS: Record<WorkOrderField, string> = {
	role: 'role',
	title: 'title',
	capacity: 'places',
	notes: 'briefing',
	event: 'event',
	equipment: 'equipment'
};

const PROJECT_FIELDS: Record<ProjectField, string> = {
	name: 'name',
	description: 'description',
	committee: 'owning committee',
	suggestion: 'linked suggestion',
	budget: 'budget',
	parent: 'parent project',
	dates: 'dates'
};

const EVENT_FIELDS: Record<EventEditField, string> = {
	title: 'title',
	description: 'description',
	kind: 'kind',
	visibility: 'visibility',
	tags: 'tags',
	location: 'venue name',
	address: 'address',
	externalTicketUrl: 'ticket link',
	venue: 'venue',
	times: 'times',
	poster: 'poster'
};

const statusWord = (s: string) =>
	(projectStatusLabels as Record<string, string>)[s]?.toLowerCase() ?? s;

const CREDIT_LABELS = { free_hours: 'credits', equipment_credits: 'equipment credits' };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^\d{2}:\d{2}$/;

/** A club date (`YYYY-MM-DD`) as "May 13, 2026"; anything else as stored. */
function day(value: string): string {
	return ISO_DAY.test(value) ? formatDateShortYear(clubInstant(value, '12:00')) : value;
}

/** An ISO timestamp's club date, as "May 13, 2026". */
const dayOf = (iso: string) => formatDateShortYear(new Date(iso));

/**
 * A booking's slot as "Tue, Nov 17, 1:30 PM–3:30 PM". Rows store the club date
 * and 24-hour clock; older rows stored display text, which passes through.
 */
function slot(d: { date: string; startTime: string; endTime: string }): string {
	if (!ISO_DAY.test(d.date) || !CLOCK.test(d.startTime) || !CLOCK.test(d.endTime)) {
		return `${d.date} ${d.startTime}–${d.endTime}`;
	}
	const at = (time: string) => formatTime(clubInstant(d.date, time));
	return `${formatDate(clubInstant(d.date, d.startTime))}, ${at(d.startTime)}–${at(d.endTime)}`;
}

/** A stored status key as its lower-case label, or as stored when it has none. */
const word = (labels: Record<string, string>, key: string) => labels[key]?.toLowerCase() ?? key;

/** A position key as its title; a key no longer offered as stored. */
const position = (key: string) => (positionLabels as Record<string, string>)[key] ?? key;

/** An empty string reads as a word, so a cleared setting is visible. */
const settingValue = (v: string | number | boolean | undefined) =>
	v === undefined || v === '' ? 'empty' : String(v);

function plural(n: number, one: string, many = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}

/** Why a payment reminder sent no email, as the log reads it. */
const PAYMENT_REMINDER_REASONS: Record<string, string> = {
	preference: 'email turned off',
	undeliverable: 'account removed',
	no_content: 'no email'
};

/** The one line a staffer reads for an audit entry. The actor and time render beside it. */
export function summarizeAuditEntry(entry: AuditEntry): string {
	switch (entry.action) {
		case 'reservation.cancelled_by_staff': {
			const d = entry.details;
			const head = `Cancelled the ${slot(d)} reservation`;
			return d.reason ? `${head}: “${d.reason}”` : head;
		}
		case 'reservation.comped': {
			const d = entry.details;
			return `Comped the ${slot(d)} reservation, waiving ${formatCents(d.waivedCents)}`;
		}
		case 'reservation.refunded': {
			const d = entry.details;
			const head = `Refunded the ${slot(d)} reservation`;
			const line = d.cancelled ? `${head} and cancelled it` : head;
			return d.reason ? `${line}: “${d.reason}”` : line;
		}
		case 'reservation.payment_reminder': {
			const d = entry.details;
			const head = `Day ${d.daysAfter} payment reminder for the ${slot(d)} reservation`;
			if (d.outcome === 'sent') return `${head}: sent`;
			const why = d.reason ? ` (${PAYMENT_REMINDER_REASONS[d.reason] ?? d.reason})` : '';
			return `${head}: ${d.outcome}${why}`;
		}
		case 'clearance.granted': {
			const d = entry.details;
			const until = d.expiresOn ? `, valid to ${day(d.expiresOn)}` : '';
			return `Granted ${d.certificationName} from ${day(d.grantedOn)}${until}`;
		}
		case 'clearance.revoked':
			return `Revoked ${entry.details.certificationName}: “${entry.details.reason}”`;
		case 'orientation.waived':
			return `Waived orientation: “${entry.details.reason}”`;
		case 'settings.changed': {
			const d = entry.details;
			const shown = d.changes.map((c) =>
				c.from === undefined && c.to === undefined
					? c.key
					: `${c.key} from ${settingValue(c.from)} to ${settingValue(c.to)}`
			);
			return `Changed ${[...shown, ...(d.redacted ?? [])].join('; ') || 'nothing'}`;
		}
		case 'event.visibility_changed':
			return `Changed visibility from ${entry.details.from} to ${entry.details.to}`;
		case 'contact.deleted':
			return 'Deleted the person';
		case 'organization.deleted':
			return 'Deleted the organization';
		case 'band.deactivated':
			return `Deactivated ${entry.details.bandName}`;
		case 'band.reactivated':
			return `Reactivated ${entry.details.bandName}`;
		case 'user.roles_changed': {
			const parts: string[] = [];
			const { added, removed } = entry.details;
			if (added.length) parts.push(`granted ${added.map(position).join(', ')}`);
			if (removed.length) parts.push(`removed ${removed.map(position).join(', ')}`);
			const line = parts.join('; ') || 'changed positions';
			return line.charAt(0).toUpperCase() + line.slice(1);
		}
		case 'user.profile_updated':
			return `Edited ${entry.details.fields.map((f) => FIELD_LABELS[f] ?? f).join(', ')}`;
		case 'user.deactivated': {
			const d = entry.details;
			const head = `Deactivated the account${d.bulk ? ' (bulk)' : ''}`;
			const took: string[] = [];
			if (d.reservationsCancelled > 0) took.push(plural(d.reservationsCancelled, 'reservation'));
			if (d.subscriptionCancelled) took.push('the membership');
			return took.length ? `${head} — cancelled ${took.join(' and ')}` : head;
		}
		case 'user.reactivated':
			return entry.details.subscription === 'lapsed'
				? 'Reactivated the account — membership had lapsed'
				: 'Reactivated the account';
		case 'user.purged':
			return entry.details.name === undefined
				? 'Permanently deleted an account (name and email removed after 24 months)'
				: `Permanently deleted ${entry.details.name} (${entry.details.email})`;
		case 'user.banned':
			return `Banned the account: “${entry.details.reason}”`;
		case 'user.unbanned':
			return 'Lifted the ban';
		case 'user.suspended':
			return `Suspended the account until ${dayOf(entry.details.endsAt)}: “${entry.details.reason}”`;
		case 'user.suspension_lifted':
			return entry.details.liftReason === 'term_lapsed'
				? 'Suspension ended at the end of its term'
				: entry.details.liftReason === 'appeal_granted'
					? 'Lifted the suspension on appeal'
					: 'Lifted the suspension';
		case 'blocklist.added':
			return 'Blocked the address from sign-up';
		case 'blocklist.removed':
			return 'Unblocked the address';
		case 'user.email_change_requested':
			return `Asked to change the login email to ${entry.details.email}`;
		case 'user.email_changed':
			return `Changed the login email from ${entry.details.previousEmail} to ${entry.details.newEmail}`;
		case 'credits.adjusted': {
			const d = entry.details;
			const verb = d.delta < 0 ? 'Deducted' : 'Added';
			return `${verb} ${Math.abs(d.delta)} ${CREDIT_LABELS[d.creditType]} (balance ${d.balanceAfter}): “${d.description}”`;
		}
		case 'capability.grants_changed': {
			const parts: string[] = [];
			if (entry.details.added.length) parts.push(`granted ${entry.details.added.join(', ')}`);
			if (entry.details.removed.length) parts.push(`removed ${entry.details.removed.join(', ')}`);
			const line = parts.join('; ') || 'saved grants unchanged';
			return line.charAt(0).toUpperCase() + line.slice(1);
		}
		case 'organization.merged':
			return `Merged ${entry.details.mergedName} into it`;
		case 'contact.merged':
			return entry.details.mergedName
				? `Merged ${entry.details.mergedName} into them`
				: 'Merged a duplicate person into them';
		case 'incident.deleted':
			return `Deleted after ${entry.details.retentionYears} years (occurred ${dayOf(entry.details.occurredAt)})`;
		case 'incident.reopened':
			return entry.details.previousResolution
				? `Reopened it, setting aside “${entry.details.previousResolution}”`
				: 'Reopened it';
		case 'incident.retention_changed':
			return entry.details.retain
				? `Marked retain: “${entry.details.reason}”`
				: `Released the retention hold: “${entry.details.reason}”`;
		case 'ballot.elector_overridden': {
			const d = entry.details;
			const verb = d.include ? 'Added to' : 'Removed from';
			return `${verb} the roll for “${d.ballotTitle}”: “${d.reason}”`;
		}
		case 'group.roster_imported': {
			const d = entry.details;
			return `Imported a roster list: ${plural(d.added, 'member')} added, ${plural(d.invited, 'invitation')} sent`;
		}
		case 'production.status_changed':
			return `Moved the show from ${entry.details.from} to ${entry.details.to}`;
		case 'production.override':
			return `Moved the show from ${entry.details.from} to ${entry.details.to} over ${plural(entry.details.warnings.length, 'warning')}: “${entry.details.reason}”`;
		case 'production.reopened':
			return `Reopened the show from ${entry.details.from} to ${entry.details.to}: “${entry.details.reason}”`;
		case 'production.payout_recorded':
			return `Recorded a ${formatCents(entry.details.amountCents)} payout to ${entry.details.actName}`;
		case 'production.payout_undone':
			return `Undid the ${formatCents(entry.details.amountCents)} payout to ${entry.details.actName}`;
		case 'production.door_recounted': {
			const d = entry.details;
			return d.firstCents === d.secondCents
				? `Counted the door a second time: ${formatCents(d.secondCents)}, matching`
				: `Counted the door a second time: ${formatCents(d.secondCents)} against ${formatCents(d.firstCents)}`;
		}
		case 'event.emailed_beyond_visibility': {
			const d = entry.details;
			const verb = d.scheduled ? 'Scheduled' : 'Sent';
			return `${verb} “${d.subject}” to ${d.audiences.join(', ')}, beyond its ${d.visibility === 'group' ? 'group' : 'members'} visibility`;
		}
		case 'event.published_over_warnings':
			return `Published the event over ${plural(entry.details.warnings.length, 'warning')}: “${entry.details.reason}”`;
		case 'volunteer_hours.approved_over_return':
			return `Approved ${formatVolunteerHours(entry.details.minutes)} from ${day(entry.details.workedOn)} that had been returned: “${entry.details.reason}”`;
		case 'event.edited_while_cancelled': {
			const fields = entry.details.fields.map((f) => EVENT_FIELDS[f] ?? f);
			return fields.length
				? `Edited its ${fields.join(', ')} while cancelled`
				: 'Saved it while cancelled, changing nothing';
		}
		case 'work_order.created':
			return `Added the task “${entry.details.title}”`;
		case 'work_order.assigned': {
			const d = entry.details;
			const head = `Changed who answers it from ${MODE_LABELS[d.from]} to ${MODE_LABELS[d.to]}`;
			const off = d.calledOff ? `${head}, calling off ${d.calledOff}` : head;
			return d.cancelledSignups > 0
				? `${off}, taking ${plural(d.cancelledSignups, 'person', 'people')} off it`
				: off;
		}
		case 'work_order.member_assigned':
			return `Assigned ${entry.details.memberName}`;
		case 'work_order.assigned_over_warnings':
			return `Assigned ${entry.details.memberName} over ${plural(entry.details.warnings.length, 'warning')}: ${entry.details.warnings.join(' ')}`;
		case 'work_order.member_unassigned':
			return `Took ${entry.details.memberName} off it`;
		case 'work_order.rescheduled':
			return 'Changed when it happens or is due';
		case 'work_order.resolved': {
			const done = entry.details.override
				? `Marked done by hand: “${entry.details.reason ?? ''}”`
				: 'Marked done';
			const open = entry.details.openBlockers ?? 0;
			if (open === 0) return done;
			return open === 1
				? `${done}, while a task it waits on was open`
				: `${done}, while ${open} tasks it waits on were open`;
		}
		case 'work_order.dependency_added':
			return `Set it to wait on ${entry.details.dependsOnLabel}`;
		case 'work_order.dependency_removed':
			return `Stopped it waiting on ${entry.details.dependsOnLabel}`;
		case 'work_order.reopened':
			return 'Reopened it';
		case 'work_order.cancelled':
			return 'Called it off';
		case 'work_order.moved':
			return 'Moved it to another section';
		case 'work_order.edited':
			return `Edited its ${entry.details.fields.map((f) => WORK_ORDER_FIELDS[f] ?? f).join(', ')}`;
		case 'work_order.member_invited':
			return `Asked ${entry.details.memberName} to do it`;
		case 'contractor_job.status_changed':
			return engagementLine(entry.details);
		case 'contractor_job.invoice_recorded': {
			const d = entry.details;
			const amount = d.costCents === null ? 'an invoice' : `a ${formatCents(d.costCents)} invoice`;
			return `Recorded ${amount} from ${d.contractorName}${d.invoiceRef ? ` (${d.invoiceRef})` : ''}`;
		}
		case 'contractor_job.reopened':
			return `Reopened ${entry.details.contractorName}'s engagement from ${contractorJobStatusLabels[entry.details.from].toLowerCase()}: “${entry.details.reason}”`;
		case 'purchase_order.reopened':
			return `Reopened the order from ${word(orderStatusLabels, entry.details.from)} to ${word(orderStatusLabels, entry.details.to)}: “${entry.details.reason}”`;
		case 'inventory_asset.reopened':
			return `Put the unit back in service from ${word(assetStatusLabels, entry.details.from)}: “${entry.details.reason}”`;
		case 'equipment_loan.checked_out_unscheduled':
			return `Checked out ${entry.details.equipmentName ?? 'a loan'} without scheduling it: “${entry.details.reason}”`;
		case 'kit_loan.checked_out_incomplete':
			return `Checked out ${entry.details.locationName} without ${entry.details.leftBehind.join(', ')}`;
		case 'kit_loan.returned_incomplete':
			return `Checked in ${entry.details.locationName} without ${entry.details.missing.join(', ')}`;
		case 'project.edited':
			return `Edited the project's ${entry.details.fields.map((f) => PROJECT_FIELDS[f] ?? f).join(', ')}`;
		case 'project.status_changed': {
			const d = entry.details;
			const head = `Moved the project from ${statusWord(d.from)} to ${statusWord(d.to)}`;
			return d.suggestionMoved ? `${head}, and its suggestion with it` : head;
		}
		case 'project.duty_list_applied': {
			const head = `Applied the template “${entry.details.dutyListName}”: ${plural(entry.details.tasks, 'task')} added`;
			const again = entry.details.reappliedReason;
			return again ? `${head}, again (${again})` : head;
		}
		case 'project.section_created':
			return `Added the section “${entry.details.name}”`;
		case 'project.section_renamed':
			return `Renamed the section “${entry.details.from}” to “${entry.details.to}”`;
		case 'project.section_deleted': {
			const d = entry.details;
			const head = `Deleted the section “${d.name}”`;
			return d.tasks > 0 ? `${head}, keeping its ${plural(d.tasks, 'task')}` : head;
		}
		case 'event.tickets_comped':
			return `Comped ${plural(entry.details.quantity, 'ticket')} for ${entry.details.attendeeName}`;
		case 'music_purchase.refunded':
			return `Refunded a ${formatCents(entry.details.amountCents)} purchase of “${entry.details.releaseTitle}”`;
		case 'production.expense_removed':
			return `Removed the ${formatCents(entry.details.amountCents)} expense “${entry.details.label}”`;
		case 'classified.visibility_changed':
		case 'suggestion.visibility_changed':
		case 'group.visibility_changed':
			return `Changed visibility from ${entry.details.from} to ${entry.details.to}`;
		case 'grant.deleted':
			return `Deleted the grant “${entry.details.title}”`;
		case 'sponsorship.deleted':
			return `Deleted the sponsorship “${entry.details.title}”`;
		case 'suggestion.merged': {
			const d = entry.details;
			return `Merged “${d.mergedTitle}” into it, moving ${plural(d.votesMoved, 'vote')}`;
		}
		case 'role.deleted':
			return 'Deleted the volunteer role';
		case 'clearance.deleted':
			return 'Deleted the clearance';
		case 'venue.deleted':
			return 'Deleted the venue';
		case 'closure.deleted': {
			const d = entry.details;
			return `Deleted the ${formatDateShort(new Date(d.startsAt))} closure: “${d.reason}”`;
		}
		case 'audience.subscriber_removed':
			return `Removed from the audience “${entry.details.audienceName}”`;
		case 'band.member_removed':
			return `Removed ${entry.details.memberName} from the band`;
		case 'gift.recorded': {
			const d = entry.details;
			return `Recorded a ${formatCents(d.valueCents)} gift given ${day(d.occurredOn)}: “${d.description}”`;
		}
		case 'group.role_changed': {
			const d = entry.details;
			if (d.role === 'member') return `Removed ${d.memberName} as a chair`;
			return d.added
				? `Added ${d.memberName} to the roster as a chair`
				: `Made ${d.memberName} a chair`;
		}
	}
}

type EngagementMove = Extract<AuditEntry, { action: 'contractor_job.status_changed' }>['details'];

/** One engagement's step: asked, booked (or rebooked), and each way it can end. */
function engagementLine(d: EngagementMove): string {
	const who = d.contractorName;
	const when = d.scheduledFor ? ` for ${formatDateShort(new Date(d.scheduledFor))}` : '';
	if (d.from === null) return `Asked ${who} to do it`;
	switch (d.to) {
		case 'booked':
			return d.from === 'booked' ? `Rebooked ${who}${when}` : `Booked ${who}${when}`;
		case 'completed':
			return `${who} finished the work`;
		case 'cancelled':
			return `Cancelled ${who}'s engagement`;
		case 'declined':
			return `${who} declined`;
		case 'no_show':
			return `${who} did not show`;
		default:
			return `${who}: ${contractorJobStatusLabels[d.to].toLowerCase()}`;
	}
}

/** An audit entry as one row of a history feed. */
export function auditFeedItem(entry: AuditEntry): FeedItem {
	return {
		id: `audit:${entry.id}`,
		at: entry.createdAt,
		actorId: entry.actorUserId,
		actorName: entry.actorName,
		summary: summarizeAuditEntry(entry)
	};
}
