import { marked } from 'marked';
import { CAMPAIGN_LAYOUT } from './campaign-layout';
import { emailButton } from '$lib/email/button';
import { escapeHtml } from '$lib/utils/html';

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
 * The inbox preview snippet, off the top of the source. Still markdown, so a
 * link near the top leaks its syntax; `{.button}` is stripped because this
 * render introduced it, and the rest is filed separately.
 */
function derivePreviewText(markdown: string): string {
	return markdown
		.slice(0, 100)
		.replaceAll('{.button}', '')
		.replace(/[#*_\n]/g, '')
		.trim();
}

function renderWithLayout(htmlContent: string, previewText: string, footerHtml: string): string {
	return CAMPAIGN_LAYOUT.replace('{{CONTENT}}', htmlContent)
		.replace('{{PREVIEW_TEXT}}', escapeHtml(previewText))
		.replace('{{FOOTER}}', footerHtml);
}

/**
 * Render a campaign for live preview in the editor.
 * Uses placeholder values for template variables.
 */
export function renderCampaignPreview(markdown: string): string {
	let html = markdownToHtml(markdown);

	// Replace template variables with preview placeholders
	html = html.replaceAll('{{subscriber_name}}', 'there');
	html = html.replaceAll('{{unsubscribe_url}}', '#');

	const previewText = derivePreviewText(markdown);
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
	html = html.replaceAll('{{subscriber_name}}', escapeHtml(subscriberName || 'there'));
	html = html.replaceAll('{{unsubscribe_url}}', escapeHtml(unsubscribeUrl));

	const previewText = derivePreviewText(markdown);
	const footerHtml = `<a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe from this list</a>`;

	return renderWithLayout(html, previewText, footerHtml);
}
