import { can } from '$lib/server/authorization';

/**
 * Why the caller may upload recap photos for this event: `event.uploadRecap`
 * held everywhere (a position, or an org-wide grant), a volunteer-role grant for
 * this event alone (the show's photographer, #1500), or not at all.
 */
export async function recapUploadAccess(
	userId: string | undefined,
	eventId: string
): Promise<'capability' | 'photographer' | null> {
	if (!userId) return null;
	if (await can('event.uploadRecap')) return 'capability';
	if (await can('event.uploadRecap', { eventId })) return 'photographer';
	return null;
}
