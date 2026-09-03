import { query } from '$app/server';
import { requireFeature, isFeatureEnabled } from '$lib/server/feature-flags';
import { getRadioNow, getRecentlyPlayed, listStationBands } from '$lib/server/audio/radio-service';

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------
// Everything here is public and unauthenticated: the station plays on the front
// page, to logged-out visitors, which is the entire point of it.

/**
 * What is on the air, and what is next.
 *
 * Returns `{ enabled: false }` rather than throwing when the flag is off,
 * because the caller is a widget mounted in the root layout on **every** page.
 * A 404 there would surface as an error boundary on the homepage, which is a
 * spectacular way for a switched-off feature to announce itself. `requireFeature`
 * stays the right shape for a route; this one is a decoration, and it leaks
 * nothing — a `false` here is already visible in the absence of the widget.
 *
 * `upNext` is deliberately part of the same payload. The widget plays through
 * the window it was given and refetches only near the end, so a listener who
 * leaves a tab open costs one request per track rather than one per poll.
 */
export const getRadioState = query(async () => {
	if (!(await isFeatureEnabled('cmcRadio'))) {
		return { enabled: false as const, serverNow: new Date(), current: null, upNext: [] };
	}

	const state = await getRadioNow();
	return { enabled: true as const, ...state };
});

/** The station page: what is on, what just played, and who is in rotation. */
export const getRadioPage = query(async () => {
	await requireFeature('cmcRadio');

	// One load-bearing query for the page. Awaiting these side by side in the
	// component would be three round trips and, past kit 2.64, a page that
	// renders its error boundary instead of itself — see
	// `custom/no-concurrent-remote-queries`.
	const [state, recent, bands] = await Promise.all([
		getRadioNow(),
		getRecentlyPlayed(12),
		listStationBands()
	]);

	return { ...state, recent, bands };
});
