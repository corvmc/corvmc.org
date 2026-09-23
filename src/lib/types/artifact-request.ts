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
	/** Poster art the artist has sent, not yet necessarily the poster. */
	deliveredUrl: string | null;
}

/** A live poster-art ask, as the artist sees it on `/act/{token}`. */
export interface PosterAsk {
	id: string;
	eventTitle: string;
	startsAt: Date;
	venue: string | null;
	bill: string[];
	dueAt: Date | null;
	deliveredUrl: string | null;
}
