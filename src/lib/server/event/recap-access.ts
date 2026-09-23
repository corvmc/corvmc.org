import { can } from '$lib/server/authorization';
import { holdsCertificationNamed } from '$lib/server/volunteer/member-certification-service';
import { RECAP_PHOTOGRAPHER_CERTIFICATION } from '$lib/config';

/**
 * Why the caller may upload recap photos: `event.uploadRecap` from the position
 * matrix, the photographer certification that stands in for it (volunteer
 * photographers hold no position, #1398), or not at all.
 */
export async function recapUploadAccess(
	userId: string | undefined
): Promise<'capability' | 'photographer' | null> {
	if (!userId) return null;
	if (await can('event.uploadRecap')) return 'capability';
	if (await holdsCertificationNamed(userId, RECAP_PHOTOGRAPHER_CERTIFICATION)) {
		return 'photographer';
	}
	return null;
}
