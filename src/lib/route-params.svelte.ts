import { page } from '$app/state';

/** The part of a route id above the segment that declares `name`, or null if none does. */
function declaredUnder(routeId: string | null | undefined, name: string): string | null {
	if (!routeId) return null;
	const segments = routeId.split('/');
	const at = segments.findIndex((segment) =>
		new RegExp(`\\[(\\[)?(\\.\\.\\.)?${name}(=[^\\]]+)?\\]`).test(segment)
	);
	return at === -1 ? null : segments.slice(0, at).join('/');
}

/**
 * The route params this component was mounted under, for use in place of
 * `page.params.x!`. Call it during component init.
 *
 * `page.params` is global, so it changes while the outgoing page is still mounted,
 * and that page's queries can re-run with the next route's params: `undefined`, or
 * a same-named value that means something else. Each value here follows the param
 * only while the route still declares it at the same place, so a layout or a
 * same-route navigation stays live and an outgoing page keeps what it had.
 */
export function routeParams<const Name extends string>(...names: Name[]): Record<Name, string> {
	const params = {} as Record<Name, string>;

	for (const name of names) {
		const owner = declaredUnder(page.route?.id, name);
		let last = page.params[name] as string;

		const value = $derived.by(() => {
			if (owner === null || declaredUnder(page.route?.id, name) === owner) {
				last = page.params[name] ?? last;
			}
			return last;
		});

		Object.defineProperty(params, name, { get: () => value, enumerable: true });
	}

	return params;
}
