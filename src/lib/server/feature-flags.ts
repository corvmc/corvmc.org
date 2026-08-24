import { error } from '@sveltejs/kit';
import { config, getConfigsByPrefix } from './site-config/site-config-service';

export type FeatureFlag =
	| 'staffInbox'
	| 'bandPremium'
	| 'emailMarketing'
	| 'equipment'
	| 'helpArticles'
	| 'contentFlags'
	| 'directMessages'
	| 'volunteering';

export const ALL_FLAGS: FeatureFlag[] = [
	'staffInbox',
	'bandPremium',
	'emailMarketing',
	'equipment',
	'helpArticles',
	'contentFlags',
	'directMessages',
	'volunteering'
];

export async function isFeatureEnabled(flag: FeatureFlag): Promise<boolean> {
	const value = await config<boolean>(`feature.${flag}`);
	return value === true;
}

export async function getAllFeatureFlags(): Promise<Record<FeatureFlag, boolean>> {
	const raw = await getConfigsByPrefix('feature');
	const flags = {} as Record<FeatureFlag, boolean>;
	for (const key of ALL_FLAGS) {
		flags[key] = raw[key] === true;
	}
	return flags;
}

export async function requireFeature(flag: FeatureFlag): Promise<void> {
	if (!(await isFeatureEnabled(flag))) {
		throw error(404, 'Not found');
	}
}
