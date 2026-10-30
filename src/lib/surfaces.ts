import { error } from '@sveltejs/kit';
import { surfaces, type Surface } from '$lib/config';

/**
 * 404 while a surface is switched off in `surfaces` (#2116). Universal, so a
 * route's `+layout.ts` and a remote function share the one gate; in a remote it
 * goes after the auth guard.
 */
export function requireSurface(surface: Surface): void {
	if (!surfaces[surface]) error(404, 'Not found');
}
