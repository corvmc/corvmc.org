import type {
	AuditAction,
	AuditEntry,
	AuditProfileField,
	ProjectField,
	WorkOrderAssignmentMode,
	WorkOrderField
} from '$lib/types/audit';
import { contractorJobStatusLabels, projectStatusLabels } from '$lib/config';
import { formatCents, formatDateShort } from '$lib/utils/format';

/** `user.roles_changed` → "User roles changed". Derived, so a new action needs no label entry. */
export function auditActionLabel(action: AuditAction): string {
	const words = action.replace('.', ' ').replaceAll('_', ' ');
	return words.charAt(0).toUpperCase() + words.slice(1);
}

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
	dates: 'dates'
};

const statusWord = (s: string) =>
	(projectStatusLabels as Record<string, string>)[s]?.toLowerCase() ?? s;

const CREDIT_LABELS = { free_hours: 'free hours', equipment_credits: 'equipment credits' };

function plural(n: number, one: string, many = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}

/** The one line a staffer reads for an audit entry. The actor and time render beside it. */
export function summarizeAuditEntry(entry: AuditEntry): string {
	switch (entry.action) {
		case 'reservation.cancelled_by_staff': {
			const d = entry.details;
			const head = `Cancelled the ${d.date} ${d.startTime}–${d.endTime} reservation`;
			return d.reason ? `${head}: “${d.reason}”` : head;
		}
		case 'band.deactivated':
			return `Deactivated ${entry.details.bandName}`;
		case 'band.reactivated':
			return `Reactivated ${entry.details.bandName}`;
		case 'user.roles_changed': {
			const parts: string[] = [];
			if (entry.details.added.length) parts.push(`granted ${entry.details.added.join(', ')}`);
			if (entry.details.removed.length) parts.push(`removed ${entry.details.removed.join(', ')}`);
			const line = parts.join('; ') || 'changed roles';
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
		case 'incident.deleted':
			return `Deleted after ${entry.details.retentionYears} years (occurred ${entry.details.occurredAt.slice(0, 10)})`;
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
		case 'event.published_over_warnings':
			return `Published the event over ${plural(entry.details.warnings.length, 'warning')}: “${entry.details.reason}”`;
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
		case 'work_order.resolved':
			return entry.details.override
				? `Marked done by hand: “${entry.details.reason ?? ''}”`
				: 'Marked done';
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
