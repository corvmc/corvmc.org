/**
 * An outstanding ask, as the console reads it.
 *
 * Here rather than beside the service because a `.svelte` file cannot reach
 * `$lib/server`.
 */

import type { RequestableArtifact } from '$lib/config';

export interface OutstandingRequest {
	id: string;
	entryId: string;
	actName: string | null;
	artifact: RequestableArtifact;
	dueAt: Date | null;
	requestedAt: Date;
	/** Derived from the artifact itself. */
	fulfilled: boolean;
	overdue: boolean;
}
