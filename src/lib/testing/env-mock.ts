/**
 * The factory for a `vi.mock('$app/env/private' | '$app/env/public')`.
 *
 * In production an unset variable reads `undefined`. A plain mock object cannot
 * say that: vitest throws on any name its factory did not return, so a service
 * reading one new variable would break every spec whose graph reaches it. `values`
 * stays live, so a spec can assign and delete on it between tests.
 */
export function envMock<T extends object>(values: T): T {
	return new Proxy(values, { has: () => true });
}
