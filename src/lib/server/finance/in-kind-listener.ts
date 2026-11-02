import { getHourLog } from '$lib/server/volunteer/hour-log-service';
import { getActiveVolunteerRoleById } from '$lib/server/volunteer/volunteer-role-service';
import { recordEntry, reverseEntriesForSubject } from './financial-entry-service';

/**
 * A returned log takes its contributed service back off the ledger.
 *
 * A reversing entry, never a delete, so a month already reported keeps its
 * figure. A no-op for a log that wrote nothing, which is most of them.
 */
export async function handleReturnedHours(logId: string): Promise<void> {
	await reverseEntriesForSubject('volunteer_hour', logId, new Date(), { label: 'Returned' });
}

/**
 * Contributed services, as a financial entry.
 *
 * **Only a specialized skill counts.** Every approved hour has an impact value
 * at the Independent Sector rate, and that is not revenue. `volunteer_role`
 * draws the FASB line already and this reads it rather than redrawing it, so
 * a door shift writes nothing here — deliberately.
 */
export async function handleApprovedHours(logId: string): Promise<void> {
	const log = await getHourLog(logId);
	if (!log) return;

	const role = await getActiveVolunteerRoleById(log.volunteerRoleId);
	// Null rate on a specialized role means priced-but-unpriced and contributes
	// zero — the schema is explicit that it must never fall back to the impact
	// rate, which would silently merge the two valuations.
	if (!role?.isSpecializedSkill || role.marketRateCents == null) return;

	const amountCents = Math.round((log.minutes / 60) * role.marketRateCents);
	if (amountCents <= 0) return;

	await recordEntry({
		amountCents,
		kind: 'in_kind',
		category: 'donation',
		// When the work happened, not when a staffer got to the queue.
		occurredAt: log.workedOn,
		settlement: 'none',
		subjectType: 'volunteer_hour',
		subjectId: log.id,
		userId: log.userId,
		description: `${log.roleName} — ${(log.minutes / 60).toFixed(2)} h at market rate`,
		metadata: { minutes: log.minutes, marketRateCents: role.marketRateCents }
	});
}
