import { error } from '@sveltejs/kit';
import { surfaces } from '#lib/config.js';

/** The switches in `surfaces` that server code gates on by name. */
export type FeatureFlag = 'directMessages' | 'bandAudio' | 'cmcRadio';

export const ALL_FLAGS: FeatureFlag[] = ['directMessages', 'bandAudio', 'cmcRadio'];

export async function isFeatureEnabled(flag: FeatureFlag): Promise<boolean> {
	return surfaces[flag];
}

export async function getAllFeatureFlags(): Promise<Record<FeatureFlag, boolean>> {
	return Object.fromEntries(ALL_FLAGS.map((flag) => [flag, surfaces[flag]])) as Record<
		FeatureFlag,
		boolean
	>;
}

export async function requireFeature(flag: FeatureFlag): Promise<void> {
	if (!surfaces[flag]) {
		throw error(404, 'Not found');
	}
}
