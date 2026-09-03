/**
 * Whether a visitor has put the radio widget away, remembered across reloads.
 *
 * Three states rather than two, because a control that vanishes with no way
 * back is worse than one that was never offered: `open` is the bar, `collapsed`
 * is a small pill you can still tune in from, and `hidden` is gone until the
 * visitor goes to /radio, which clears this.
 *
 * Deliberately plain functions rather than module-level `$state` in a
 * `.svelte.ts` — that would be one store shared by every concurrent SSR
 * request, and this one is read on a component mounted into every page in the
 * app. Copied in shape from `Nav/nav-collapse.ts`, which made the same call for
 * the same reason.
 */

const STORAGE_KEY = 'cmc:radio-widget';

export type RadioWidgetState = 'open' | 'collapsed' | 'hidden';

const VALID: RadioWidgetState[] = ['open', 'collapsed', 'hidden'];

/**
 * `open` is the default, so an absent entry means the widget shows. That is the
 * right way round: a visitor who has never expressed a preference should meet
 * the station, and nobody's stored `hidden` is lost by adding a state later.
 */
export function readWidgetState(): RadioWidgetState {
	// The widget renders on the server, and Safari's private mode throws on
	// access rather than returning null.
	if (typeof localStorage === 'undefined') return 'open';
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return VALID.includes(raw as RadioWidgetState) ? (raw as RadioWidgetState) : 'open';
	} catch {
		return 'open';
	}
}

export function writeWidgetState(state: RadioWidgetState): void {
	if (typeof localStorage === 'undefined') return;
	try {
		if (state === 'open') localStorage.removeItem(STORAGE_KEY);
		else localStorage.setItem(STORAGE_KEY, state);
	} catch {
		// Quota, or private mode. Losing the preference is not worth an error.
	}
}
