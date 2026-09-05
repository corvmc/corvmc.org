import { goto } from '$app/navigation';
import { page } from '$app/state';
import { parseFields, toHref, type UrlFields } from '$lib/utils/url-filters';

/**
 * Filter state that lives in the URL, so a reload — or a link a staffer pastes
 * into the inbox — lands on the same view.
 *
 * Two rules, both learned the hard way, and both encoded here once instead of
 * in the comment every page used to carry:
 *
 * - **Local state is the source of truth, and the URL is written from it.**
 *   Reading `page.url` back out means a filter change re-renders only once the
 *   navigation that mirrors it has landed.
 * - **`goto(..., { replaceState })`, never `replaceState()`.** The latter
 *   updates neither `page.url` nor the router's own state, so backing out of a
 *   detail page returned to the wrong filter.
 *
 * `path` is a resolved href — pass `resolve('/staff/events')`. The returned
 * object is plain reactive state: read it in a `$derived`, assign to it from a
 * handler, `bind:` to it from a control.
 *
 *     const filters = urlState(resolve('/staff/events'), {
 *         view: oneOf(views, 'review'),
 *         source: text<Source>(),
 *         page: positiveInt(1)
 *     });
 */
export function urlState<S extends Record<string, unknown>>(path: string, fields: UrlFields<S>): S {
	// Read once, at mount. A staffer arriving from a notification link has no
	// query string at all, so every field has to be able to answer for itself.
	const values = $state(parseFields(fields, page.url.searchParams));

	// Writes the URL, never state. The guard matters: without it the navigation
	// this effect triggers re-runs the effect, which navigates again.
	$effect(() => {
		const target = toHref(path, fields, values);
		if (location.pathname + location.search !== target) {
			void goto(target, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});

	return values;
}

export { oneOf, positiveInt, text, type UrlField, type UrlFields } from '$lib/utils/url-filters';
