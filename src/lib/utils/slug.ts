/**
 * Generate a URL-friendly slug from a string.
 *
 * Lowercases, then **drops** anything that isn't a letter, digit or hyphen —
 * slug generation never introduces a hyphen of its own. 'Rock & Roll' is
 * `rockroll`, not `rock-roll`. Hyphens already in the source survive, with runs
 * collapsed and the ends trimmed, so 'Sun-Ra' stays `sun-ra`. Pure, so a form
 * can preview the address the server will store.
 */
export function generateSlug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '')
		.replace(/-{2,}/g, '-')
		.replace(/^-|-$/g, '');
}
