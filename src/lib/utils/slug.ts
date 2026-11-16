/**
 * A URL-friendly slug: lowercased, with anything not a letter, digit or hyphen
 * dropped rather than hyphenated ('Rock & Roll' is `rockroll`). Typed hyphens
 * survive, runs collapsed and ends trimmed ('Sun-Ra' stays `sun-ra`). Pure, so
 * a form can preview the address the server will store.
 */
export function generateSlug(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '')
		.replace(/-{2,}/g, '-')
		.replace(/^-|-$/g, '');
}
