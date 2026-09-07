import type { FeatureFlag } from '$lib/server/feature-flags';

/**
 * What the Features tab says about each flag.
 *
 * Keyed by `FeatureFlag`, which is the whole point: this was the fifth
 * hand-maintained copy of the flag list and the only one nothing guarded, so
 * it drifted silently in both directions. It was missing `directMessages` —
 * a flag enforced at seven call sites with no toggle anywhere in the app — and
 * a stale key would have rendered a toggle that `VALID_FLAGS` rejects with a
 * 400 on click, which is exactly what `contentFlags` once did from the other
 * side of the same gap.
 *
 * Its own file, like `inbox-channel-meta.ts` beside it, so the coverage is
 * testable without rendering the page.
 */
export const featureMeta: Record<FeatureFlag, { label: string; description: string }> = {
	// Enforced since it was written and never switchable: the tab was added
	// after this flag, and nobody noticed it had no row. Off in production, so
	// giving it a toggle changes nothing until someone presses it.
	directMessages: {
		label: 'Direct messages',
		description:
			'Members can message each other from the directory. Member↔staff conversations are not affected — those are never gated.'
	},
	bandAudio: {
		label: 'Band music',
		description: 'Bands can upload releases and sell them. Uploading is what fills CMC Radio.'
	},
	cmcRadio: {
		label: 'CMC Radio',
		description:
			'The site-wide station and its player. Leave this off until enough bands have opted in for the rotation to sound like one.'
	}
};
