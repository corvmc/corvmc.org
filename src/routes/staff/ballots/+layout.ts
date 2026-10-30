import { requireSurface } from '$lib/surfaces';

/** Off in code (#2116). The remotes refuse as well; this only makes the page a 404. */
export function load() {
	requireSurface('ballots');
}
