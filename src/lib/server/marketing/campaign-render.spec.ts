import { describe, it, expect } from 'vitest';
import { renderCampaignPreview, renderCampaignForSend } from './campaign-render';

const MARKDOWN = '# Real Book Club\n\nFirst Thursday of the month. **Bring a chart.**';

describe('renderCampaignForSend', () => {
	const html = renderCampaignForSend(MARKDOWN, 'Maya', 'https://corvmc.org/unsub?t=abc');

	it('wraps the content in the branded shell', () => {
		// Tri-stripe in order, logo, and the 501(c)(3) footer line.
		expect(html).toMatch(/#00859b[\s\S]*#ffb500[\s\S]*#f84d13/);
		expect(html).toContain('https://corvmc.org/email/cmc-speaker.png');
		expect(html).toContain('501(c)(3)');
	});

	it('renders the markdown body', () => {
		expect(html).toContain('Real Book Club');
		expect(html).toContain('<strong>Bring a chart.</strong>');
	});

	it('leaves no unsubstituted layout placeholders', () => {
		expect(html).not.toContain('{{CONTENT}}');
		expect(html).not.toContain('{{PREVIEW_TEXT}}');
		expect(html).not.toContain('{{FOOTER}}');
	});

	it('substitutes the unsubscribe url into the footer', () => {
		expect(html).toContain('https://corvmc.org/unsub?t=abc');
	});

	it('populates the preheader', () => {
		const preheader = html.match(/mso-hide:all[^>]*>([^<]*)</)?.[1] ?? '';
		expect(preheader.trim()).not.toBe('');
	});

	it('escapes a hostile subscriber name', () => {
		const hostile = renderCampaignForSend(
			'Hello {{subscriber_name}}',
			'<script>alert(1)</script>',
			'https://corvmc.org/unsub'
		);
		expect(hostile).not.toContain('<script>alert(1)</script>');
		expect(hostile).toContain('&lt;script&gt;');
	});
});

describe('renderCampaignPreview', () => {
	it('fills template variables with placeholders rather than leaving them raw', () => {
		const html = renderCampaignPreview('Hi {{subscriber_name}}, see {{unsubscribe_url}}');
		expect(html).toContain('Hi there');
		expect(html).not.toContain('{{subscriber_name}}');
		expect(html).not.toContain('{{unsubscribe_url}}');
	});
});

// ---------------------------------------------------------------------------
// The {.button} CTA (#647)
// ---------------------------------------------------------------------------
const BUTTON_MD = '[Buy Tickets](https://corvmc.org/events/1?ref=email){.button}';

describe('campaign buttons', () => {
	const html = renderCampaignForSend(BUTTON_MD, 'Maya', 'https://corvmc.org/unsub');

	it('promotes a tagged link into the offset-shadow button', () => {
		// bgcolor as an attribute, not just CSS: Word-engine Outlook drops
		// background-color on the cell and the button would render white.
		expect(html).toContain('bgcolor="#e5771e"');
		expect(html).toContain('class="btn-cell"');
		expect(html).toContain('>Buy Tickets</a>');
	});

	it('keeps the query string in the href', () => {
		expect(html).toContain('href="https://corvmc.org/events/1?ref=email"');
	});

	it('leaves the marker nowhere in the output', () => {
		expect(html).not.toContain('{.button}');
	});

	it('renders the same button in the editor preview as in the send', () => {
		// Two entry points, one markdownToHtml — a staffer who sees a button in
		// the composer has to get one in the mail.
		const preview = renderCampaignPreview(BUTTON_MD);
		expect(preview).toContain('bgcolor="#e5771e"');
		expect(preview).toContain('class="btn-cell"');
	});

	it('leaves an untagged link as an inline link', () => {
		const plain = renderCampaignForSend('[Buy Tickets](https://corvmc.org/x)', null, '#');
		expect(plain).not.toContain('class="btn-cell"');
		expect(plain).toContain('<a href="https://corvmc.org/x"');
	});

	it('leaves a tagged link that shares its paragraph alone', () => {
		// The marker promotes a whole paragraph, so it only applies when the
		// link is the only thing in it.
		const inline = renderCampaignForSend('Go now [Buy](https://corvmc.org/x){.button}', null, '#');
		expect(inline).not.toContain('class="btn-cell"');
	});
});

describe('campaign heading styles', () => {
	it('styles every heading level markdown can emit', () => {
		const html = renderCampaignForSend('#### Fourth', 'Maya', '#');
		// An unstyled h4 falls through to the client default — Times, undersized.
		expect(html).toContain('.content h4 { font-size:17px; }');
		expect(html).toContain('<h4>Fourth</h4>');
	});
});
