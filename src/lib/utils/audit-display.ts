import type { AuditAction, AuditEntry, AuditProfileField } from '$lib/types/audit';

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
			return `Permanently deleted ${entry.details.name} (${entry.details.email})`;
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
		case 'incident.deleted':
			return `Deleted after ${entry.details.retentionYears} years (occurred ${entry.details.occurredAt.slice(0, 10)})`;
	}
}
