import { error } from '@sveltejs/kit';
import { config, getConfigsByPrefix } from './site-config/site-config-service';

export type FeatureFlag =
	| 'staffInbox'
	| 'bandPremium'
	| 'emailMarketing'
	| 'helpArticles'
	| 'contentFlags'
	| 'directMessages'
	| 'volunteering'
	// The groups module. `groups` gates clubs and committees — the staff panel,
	// the member page and the public group directory. The other three cover bands
	// as well, because both capabilities key off group membership and a band is a
	// group. See docs/specs/groups-spec.md.
	| 'groups'
	| 'groupEvents'
	| 'groupFiles'
	| 'announcements';

export const ALL_FLAGS: FeatureFlag[] = [
	'staffInbox',
	'bandPremium',
	'emailMarketing',
	'helpArticles',
	'contentFlags',
	'directMessages',
	'volunteering',
	'groups',
	'groupEvents',
	'groupFiles',
	'announcements'
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
