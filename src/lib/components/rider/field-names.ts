/**
 * SvelteKit parses **every** submitted field name into a schema path against
 * `/^[a-zA-Z_$]\w*(\.[a-zA-Z_$]\w*|\[\d+\])*$/` — including the editor-state
 * names that exist only to pair a label with its input and that Zod is going to
 * strip as unknown.
 *
 * A name that fails the regex kills the whole submit with `Invalid path`,
 * **client-side, before any request is made**. There is no server log, no
 * network entry and no validation message: the symptom is a Save button that
 * does nothing at all.
 *
 * The rider editor prefixes its field names with a **user id** to keep two
 * editors on one page apart, and every user id is illegal — `seed-rider-member`
 * has hyphens, and a real uuid both has hyphens and can start with a digit. So
 * the prefix is sanitised rather than trusted, and it happens here, once,
 * instead of at each call site: the failure is silent and nobody passing a
 * display-only name expects it to matter.
 */
export function safeFieldPrefix(raw: string): string {
	// The leading letter is not decoration — the regex requires the first
	// character to be `[a-zA-Z_$]`, and half of all uuids start with a digit.
	return 'f' + raw.replace(/[^A-Za-z0-9]/g, '_');
}

/** The path grammar SvelteKit validates a submitted field name against. */
export const FIELD_NAME_PATTERN = /^[a-zA-Z_$]\w*(\.[a-zA-Z_$]\w*|\[\d+\])*$/;
