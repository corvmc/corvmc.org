import { getJson, putJson } from '$lib/server/kv';

/**
 * Soft KV-backed rate limit: allow at most `max` hits per `key` within
 * `ttlSeconds`. KV is eventually consistent, so this is a best-effort
 * throttle for abuse mitigation, not a hard guarantee — pair it with a
 * stronger gate (e.g. Turnstile) on public endpoints.
 *
 * Returns true when the hit is allowed. The TTL restarts on each allowed hit
 * (a rejected one returns before writing), so the window is fixed-with-refresh
 * rather than sliding.
 *
 * Cloudflare's own rate-limiting binding is not the upgrade path here, and was
 * checked rather than assumed: its `period` is 10 or 60 seconds only, and every
 * caller of this function is a product quota measured in hours or days — the
 * shortest is five minutes. See "Rate limiting: KV, on purpose" in
 * docs/architecture/overview.md for the table.
 */
export async function allowRateLimited(
	key: string,
	max: number,
	ttlSeconds: number
): Promise<boolean> {
	const kvKey = `rate-limit:${key}`;
	const count = (await getJson<number>(kvKey)) ?? 0;
	if (count >= max) return false;
	await putJson(kvKey, count + 1, Math.max(ttlSeconds, 60));
	return true;
}
