/**
 * Retry a boundary whose remote query failed.
 *
 * `reset()` alone only re-renders the boundary, and the component then reads
 * the same rejected query back out of the cache — so the alert outlives the
 * outage that caused it. `refresh()` is what re-requests; it rejects again
 * when the fault persists, and the boundary catches that on re-render.
 */
export async function retryQuery(query: { refresh: () => Promise<unknown> }, reset: () => void) {
	await query.refresh().catch(() => {});
	reset();
}
