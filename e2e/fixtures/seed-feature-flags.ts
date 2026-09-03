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
 * `directMessages` gates every member↔member endpoint and the recipient picker —
 * without it `requireFeature` rejects before any of the messaging lifecycle can
 * be exercised.
 *
 * `bandPremium` is gone from this list because it launched: the subscription
 * page, the page editor and /band-site/** answer on tier alone now. Those specs
 * passing with nothing seeded for them is the proof the guard was the only thing
 * between the route and the user.
 *
 * The groups module needs nothing here any more: `groups`, `groupEvents` and
 * `announcements` were retired with the flag system, so the club page, the
 * Sessions tab and the announcement surfaces answer unconditionally. They are
 * unlinked from navigation rather than gated, which is why the specs reach them
 * by URL.
 *
 * Inventory is deliberately absent: its flag was cut in #286, so the member
 * surface and the scan-resolution pages need no enabling here.
 */
export const ENABLED_FLAGS = ['directMessages'] as const;

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
