/**
 * Turn on the feature flags the e2e suite needs, in the LOCAL KV namespace used
 * by `vite preview`. Flags live in KV (`site-config:feature.*`, see
 * src/lib/server/site-config/site-config-service.ts) and all default to false,
 * so a flagged surface 404s in e2e unless it is enabled here.
 *
 * Run by `e2e/prepare.ts`, before Playwright starts the preview server.
 *
 * Idempotent: writes the same values on every run.
 */
import { withPlatformEnv } from './platform-db';

/**
 * `bandPremium` gates /band/[slug]/subscription, the page editor and
 * /band-site/**. `directMessages` gates every member↔member endpoint and the
 * recipient picker — without it `requireFeature` rejects before any of the
 * messaging lifecycle can be exercised.
 */
export const ENABLED_FLAGS = ['bandPremium', 'directMessages'] as const;

export async function seedFeatureFlags(): Promise<void> {
	await withPlatformEnv(async ({ env }) => {
		const kv = (env as { KV: KVNamespace }).KV;
		for (const flag of ENABLED_FLAGS) {
			// Same encoding as putJson() in src/lib/server/kv.ts — the app reads
			// these back with get(key, 'json').
			await kv.put(`site-config:feature.${flag}`, JSON.stringify(true));
		}
	});
}
