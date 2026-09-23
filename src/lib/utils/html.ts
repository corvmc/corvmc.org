/** Escape a plain string for interpolation into HTML text or an attribute value. */
export function escapeHtml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * The inverse of `escapeHtml`, for flattening rendered HTML back to text.
 *
 * Covers exactly what `escapeHtml` and `marked` emit. `&amp;` is decoded last
 * so `&amp;lt;` comes back as the literal `&lt;` rather than a `<`.
 */
export function unescapeHtml(str: string): string {
	return str
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#(?:39|x27);/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&');
}

/**
 * Escape a plain string and preserve its line breaks as `<br />`.
 *
 * For user-generated text rendered into email, where `white-space: pre-wrap`
 * is unreliable (Word-engine Outlook ignores it and collapses the whole
 * message onto one line).
 */
export function escapeHtmlWithBreaks(str: string): string {
	return escapeHtml(str).replace(/\r?\n/g, '<br />');
}

/** Tags whose end is a visible break, so flattening must not join across them. */
const BLOCK_END = /<\/(?:p|h[1-6]|li|blockquote|div|pre)>|<br\s*\/?>/gi;

/**
 * Flatten rich-text HTML to plain text for surfaces that render text only,
 * such as a calendar entry: block ends become line breaks, tags are dropped
 * and entities decoded. Not a sanitizer; the result must still be escaped.
 */
export function htmlToPlainText(html: string): string {
	return unescapeHtml(html.replace(BLOCK_END, '\n').replace(/<[^>]*>/g, ''))
		.replace(/[ \t]*\n[ \t]*/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}
