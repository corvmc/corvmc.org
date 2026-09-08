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
// ---------------------------------------------------------------------------
// `$`-expansion in a spliced value (#746)
// ---------------------------------------------------------------------------
// A string-pattern replacement still scans its *replacement* for `$&`, `` $` ``,
// `$'` and `$$`, so a member-written value that contains one splices the
// layout into itself. Every value below is member-written.
// ---------------------------------------------------------------------------

const UNSUB = 'https://corvmc.org/unsub?t=abc';

describe('dollar sequences in spliced values (#746)', () => {
	it('leaves a body containing $& intact', () => {
		const html = renderCampaignForSend(
			'Tickets are $15. Cost is 100% of $&whatever.',
			'Maya',
			UNSUB
		);
		expect(html).not.toContain('{{CONTENT}}');
		expect(html).toContain('$&amp;whatever');
	});

	it.each(['$&', '$`', "$'", '$$', '$1'])('leaves a body containing %s intact', (seq) => {
		const html = renderCampaignForSend(`Deal: ${seq}end`, 'Maya', UNSUB);
		expect(html).not.toContain('{{CONTENT}}');
		expect(html).not.toContain('{{PREVIEW_TEXT}}');
		expect(html).not.toContain('{{FOOTER}}');
		expect(html).not.toContain('<!doctype html><!doctype');
	});

	it('leaves a subscriber name containing $& intact', () => {
		const html = renderCampaignForSend('Hi {{subscriber_name}}!', '$&', UNSUB);
		expect(html).not.toContain('{{subscriber_name}}');
		expect(html).toContain('Hi $&amp;!');
	});

	it('leaves an unsubscribe url containing $& intact', () => {
		const html = renderCampaignForSend('Bye', 'Maya', 'https://corvmc.org/unsub?t=a$&b');
		expect(html).not.toContain('{{FOOTER}}');
		expect(html).toContain('t=a$&amp;b');
	});

	it('leaves the preheader intact when the body opens with $&', () => {
		const html = renderCampaignForSend('$&opening line', 'Maya', UNSUB);
		expect(html).not.toContain('{{PREVIEW_TEXT}}');
	});

	it('applies to the editor preview too', () => {
		const html = renderCampaignPreview('Cost is 100% of $&whatever.');
		expect(html).not.toContain('{{CONTENT}}');
	});
});

// ---------------------------------------------------------------------------
// The preheader is rendered text, not markdown source (#747)
// ---------------------------------------------------------------------------

function preheaderOf(html: string): string {
	return (html.match(/mso-hide:all[^>]*>([^<]*)</)?.[1] ?? '').trim();
}

describe('preheader (#747)', () => {
	it('shows a leading link as its label, not its markdown', () => {
		const html = renderCampaignForSend(
			'[Buy Tickets](https://corvmc.org/events/1)\n\nDoors at 7.',
			'Maya',
			UNSUB
		);
		const preheader = preheaderOf(html);
		expect(preheader).toContain('Buy Tickets');
		expect(preheader).not.toContain('](');
		expect(preheader).not.toContain('https://corvmc.org/events/1');
	});

	it('shows a leading button link as its label', () => {
		const html = renderCampaignForSend(
			'[Buy Tickets](https://corvmc.org/events/1){.button}\n\nDoors at 7.',
			'Maya',
			UNSUB
		);
		const preheader = preheaderOf(html);
		expect(preheader).toContain('Buy Tickets');
		expect(preheader).not.toContain('{.button}');
		expect(preheader).not.toContain('https://');
	});

	it('drops list, quote and code markers', () => {
		const html = renderCampaignForSend(
			'> A quote\n\n- One item\n- Two item\n\n`code span`',
			'Maya',
			UNSUB
		);
		const preheader = preheaderOf(html);
		expect(preheader).toContain('A quote');
		expect(preheader).toContain('One item');
		expect(preheader).not.toMatch(/[>`]/);
		expect(preheader).not.toMatch(/(^|\s)-\s/);
	});

	it('keeps # and * that are prose rather than markup', () => {
		const html = renderCampaignForSend('Save 50% * limited. Key of C# minor.', 'Maya', UNSUB);
		const preheader = preheaderOf(html);
		expect(preheader).toContain('50% * limited');
		expect(preheader).toContain('C# minor');
	});

	it('decodes entities rather than showing them, and does not double-escape', () => {
		const html = renderCampaignForSend('Tom & Jerry play tonight.', 'Maya', UNSUB);
		const preheader = preheaderOf(html);
		expect(preheader).toContain('Tom &amp; Jerry');
		expect(preheader).not.toContain('&amp;amp;');
	});

	it('truncates on a word boundary with an ellipsis', () => {
		const html = renderCampaignForSend(`${'Corvallis '.repeat(40)}tail`, 'Maya', UNSUB);
		const preheader = preheaderOf(html);
		expect(preheader.endsWith('…')).toBe(true);
		expect(preheader).not.toContain('tail');
		// Nothing chopped mid-word: the last token before the ellipsis is whole.
		expect(preheader.replace('…', '').trim().split(' ').at(-1)).toBe('Corvallis');
	});

	it('keeps separate blocks from running together', () => {
		const html = renderCampaignForSend('# Real Book Club\n\nFirst Thursday.', 'Maya', UNSUB);
		expect(preheaderOf(html)).toBe('Real Book Club First Thursday.');
	});
});
