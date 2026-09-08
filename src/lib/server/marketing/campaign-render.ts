import { marked } from 'marked';
import { CAMPAIGN_LAYOUT } from './campaign-layout';
import { emailButton } from '$lib/email/button';
import { escapeHtml, unescapeHtml } from '$lib/utils/html';

// ---------------------------------------------------------------------------
// Campaign email rendering
// ---------------------------------------------------------------------------
// Markdown → HTML → injected into the branded campaign layout.
// ---------------------------------------------------------------------------

/**
 * A link alone in its paragraph, tagged `{.button}`, becomes the brand button:
 * `[Buy Tickets](https://corvmc.org/events/1){.button}`.
 *
 * A post-parse pass rather than a `marked` extension, so both render entry
 * points get it from the one `markdownToHtml` they share.
 */
const BUTTON_PARAGRAPH = /<p>\s*<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>\s*\{\.button\}\s*<\/p>/g;

function promoteButtons(html: string): string {
	return html.replace(BUTTON_PARAGRAPH, (_match, href: string, label: string) =>
		emailButton(href, label)
	);
}

function markdownToHtml(markdown: string): string {
	return promoteButtons(marked.parse(markdown, { async: false }) as string);
}

/**
 * Splice a value into a template placeholder.
 *
 * The replacement is a *function* deliberately: a string replacement is still
 * scanned for `$&`, `` $` ``, `$'` and `$$`, so a body reading "100% of
 * $&whatever" would splice the placeholder back into itself and reach the
 * reader as `{{CONTENT}}amp;whatever`.
 */
function splice(template: string, placeholder: string, value: string): string {
	return template.replaceAll(placeholder, () => value);
}

/** Mail clients truncate the preview well before this. */
const PREVIEW_TEXT_MAX = 140;

/** Tags whose end is a visible break, so flattening must not join across them. */
const BLOCK_BOUNDARY = /<\/(?:p|h[1-6]|li|blockquote|div|td|tr|table|pre)>|<br\s*\/?>/gi;

/**
 * The inbox preview snippet, flattened out of the *rendered* body.
 *
 * Taking it off the markdown source put a leading CTA in the preview pane as
 * `[Buy Tickets](https://…)`, and stripping `#*_` by character class ate the
 * asterisk in "50% * limited". Rendering first is also what the transactional
 * side does (`notification/email/normalize-model.ts`), so both halves agree.
 */
function derivePreviewText(html: string): string {
	const flat = unescapeHtml(html.replace(BLOCK_BOUNDARY, ' ').replace(/<[^>]+>/g, ''))
		.replaceAll('{.button}', '')
		.replace(/\s+/g, ' ')
		.trim();

	if (flat.length <= PREVIEW_TEXT_MAX) return flat;
	// Cut back to a word boundary: the one line a recipient reads before
	// opening should not end mid-word.
	const cut = flat.slice(0, PREVIEW_TEXT_MAX - 1);
	const lastSpace = cut.lastIndexOf(' ');
	return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function renderWithLayout(htmlContent: string, previewText: string, footerHtml: string): string {
	const withContent = splice(CAMPAIGN_LAYOUT, '{{CONTENT}}', htmlContent);
	const withPreview = splice(withContent, '{{PREVIEW_TEXT}}', escapeHtml(previewText));
	return splice(withPreview, '{{FOOTER}}', footerHtml);
}

/**
 * Render a campaign for live preview in the editor.
 * Uses placeholder values for template variables.
 */
export function renderCampaignPreview(markdown: string): string {
	let html = markdownToHtml(markdown);

	// Replace template variables with preview placeholders
	html = splice(html, '{{subscriber_name}}', 'there');
	html = splice(html, '{{unsubscribe_url}}', '#');

	const previewText = derivePreviewText(html);
	const footerHtml = '<a href="#">Unsubscribe from this list</a>';

	return renderWithLayout(html, previewText, footerHtml);
}

/**
 * Render a campaign for actual sending to a specific recipient.
 */
export function renderCampaignForSend(
	markdown: string,
	subscriberName: string | null,
	unsubscribeUrl: string
): string {
	let html = markdownToHtml(markdown);

	// Replace template variables with real values
	html = splice(html, '{{subscriber_name}}', escapeHtml(subscriberName || 'there'));
	html = splice(html, '{{unsubscribe_url}}', escapeHtml(unsubscribeUrl));

	const previewText = derivePreviewText(html);
	const footerHtml = `<a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe from this list</a>`;

	return renderWithLayout(html, previewText, footerHtml);
}
