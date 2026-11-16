/** Rows a D1 write changed. Schema-free, so a spec that mocks `db` can keep the real one. */
export function getRowCount(result: unknown): number {
	const r = result as { meta?: { changes?: number } };
	return r?.meta?.changes ?? 0;
}
