/**
 * The current viewer, for link resolution.
 *
 * Context rather than a `.svelte.ts` module store, and this is not a style
 * choice: module-level state mutated during SSR is shared across requests, so
 * one user's identity can be served to the next. Context is per-request by
 * construction.
 *
 * Uses the `setContext`/`hasContext` idiom from `Form.svelte` rather than
 * `createContext`, despite the latter being newer and better typed, because
 * `createContext`'s getter *throws* when no parent set it — and these
 * components have to degrade to public links instead of exploding when a
 * layout is missing the provider.
 */
import { getContext, hasContext, setContext } from 'svelte';
import { ANONYMOUS, type Viewer } from '$lib/types/entity';

const VIEWER_KEY = Symbol('entity-viewer');

export function setEntityViewer(viewer: Viewer): void {
	setContext(VIEWER_KEY, viewer);
}

let warned = false;

/**
 * The viewer, or an anonymous one when no provider is mounted.
 *
 * Falling back to anonymous means every link degrades to its public route,
 * which is the harmless direction: a member sent to a public profile is a
 * cosmetic bug, whereas a member handed a `/staff/…` URL gets a 403 they
 * cannot explain.
 *
 * These components are for the staff/member panels, all of which mount
 * `EntityViewer`, so a miss is a wiring mistake rather than a supported mode —
 * hence the dev-only warning. It fires once, not once per chip.
 */
export function getEntityViewer(): Viewer {
	if (hasContext(VIEWER_KEY)) return getContext<Viewer>(VIEWER_KEY);
	if (import.meta.env.DEV && !warned) {
		warned = true;
		console.warn(
			'[entity] No <EntityViewer> above this component — links will resolve to public routes. ' +
				'Mount it in the panel layout.'
		);
	}
	return ANONYMOUS;
}
