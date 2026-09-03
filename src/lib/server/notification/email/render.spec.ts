import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { renderTemplate, readMeta } from './render-preview';
import { FIXTURES } from './fixtures';
import { normalizeNotificationModel } from './normalize-model';

// ---------------------------------------------------------------------------
// Postmark template rendering
// ---------------------------------------------------------------------------
// Renders the real files in postmark/templates/ with the local Handlebars
// renderer. `pnpm email:validate` is the authoritative check (it runs Postmark's
// own Mustachio), but that needs credentials and a network call — these tests
// catch the same class of breakage in CI: broken loops, misspelled model keys,
// unclosed blocks, and lost escaping.
// ---------------------------------------------------------------------------

const byName = (name: string) => {
	const fixture = FIXTURES.find((f) => f.name === name);
	if (!fixture) throw new Error(`No fixture named ${name}`);
	return renderTemplate(fixture.alias, fixture.model);
};

// An email the recipient can reply to is sent as text/plain with no layout;
// `corvmc-transactional` is for one-way mail only. The absence of a
// LayoutTemplate is the authoritative marker, so derive the split from it
// rather than tagging fixtures by hand.
const isPlaintext = (alias: string) => !readMeta(alias).LayoutTemplate;
const LAYOUT_FIXTURES = FIXTURES.filter((f) => !isPlaintext(f.alias));
const PLAINTEXT_FIXTURES = FIXTURES.filter((f) => isPlaintext(f.alias));

describe.each(FIXTURES)('$name', (fixture) => {
	const { text } = renderTemplate(fixture.alias, fixture.model);

	it('leaves no unresolved template tags in the text part', () => {
		expect(text).not.toMatch(/\{\{/);
	});
});

describe.each(LAYOUT_FIXTURES)('$name (layout)', (fixture) => {
	const { html } = renderTemplate(fixture.alias, fixture.model);

	it('leaves no unresolved template tags in the HTML part', () => {
		expect(html).not.toMatch(/\{\{/);
	});

	it('populates the hidden preheader', () => {
		// The preheader div is the first element in <body>; assert it has content.
		const preheader = html.match(/mso-hide:all[^>]*>([^<]*)</)?.[1] ?? '';
		expect(preheader.trim()).not.toBe('');
	});

	it('renders the brand chrome from the layout', () => {
		// Tri-stripe, in order, plus the parchment footer.
		expect(html).toMatch(/#00859b[\s\S]*#ffb500[\s\S]*#f84d13/);
		expect(html).toContain('https://corvmc.org/email/cmc-speaker.png');
		expect(html).toContain('6775 SW Philomath Blvd');
	});

	it('links to notification preferences in the footer', () => {
		expect(html).toContain('https://corvmc.org/member/account');
	});
});

describe.each(PLAINTEXT_FIXTURES)('$name (plaintext)', (fixture) => {
	const { html, text } = renderTemplate(fixture.alias, fixture.model);

	it('ships no HTML part at all', () => {
		expect(html).toBe('');
		expect(existsSync(`postmark/templates/${fixture.alias}/content.html`)).toBe(false);
	});

	it('puts no markup in the text part', () => {
		// Not a blanket `<...>` ban — `Name <addr@host>` is RFC 5322 address
		// syntax and belongs in a plain-text body. This catches HTML leaking in.
		expect(text).not.toMatch(/<\/?(?:p|div|br|a|span|table|tr|td|img|strong|em)\b[^>]*>/i);
	});

	it('carries none of the one-way layout chrome', () => {
		for (const marker of ['#00859b', 'cmc-speaker.png', '6775 SW Philomath Blvd']) {
			expect(text).not.toContain(marker);
		}
	});

	it('tells the reader how to reply', () => {
		// The whole point of the plaintext treatment: these are two-way emails,
		// so every one of them has to say so in the body.
		expect(text).toMatch(/repl(y|ies)/i);
	});
});

describe('notification — optional blocks', () => {
	it('omits the details card, CTA and quote when the model has none', () => {
		const { html } = byName('notification-minimal');
		expect(html).not.toContain('class="pass-card"');
		expect(html).not.toContain('class="btn-cell"');
		expect(html).not.toContain('class="quote-bg"');
	});

	it('renders one details card containing every row', () => {
		const { html } = byName('notification-full');
		expect(html.match(/class="pass-card"/g)).toHaveLength(1);
		for (const value of ['Main Practice', 'Indigo Kiss', '7:00 PM – 9:00 PM']) {
			expect(html).toContain(value);
		}
	});

	it('puts the CTA url in an href in both parts', () => {
		const { html, text } = byName('notification-full');
		expect(html).toContain('href="https://corvmc.org/member/reservations"');
		expect(text).toContain('https://corvmc.org/member/reservations');
	});

	it('renders the quote callout only when a quote is present', () => {
		expect(byName('notification-with-quote').html).toContain('class="quote-bg"');
		expect(byName('notification-full').html).not.toContain('class="quote-bg"');
	});
});

describe('notification — escaping', () => {
	const { html, text } = byName('notification-escaping');

	it('escapes HTML in paragraphs, heading, details and footnote', () => {
		// Assert the angle brackets are neutralised, not the exact entity soup —
		// engines differ on which extra characters they escape (Handlebars also
		// escapes `=`), and pinning that would make this a renderer test.
		expect(html).not.toContain('<script>');
		expect(html).not.toContain('<i>footnote</i>');
		// The layout has a legitimate logo <img>; no injected one survives as a tag.
		expect(html).not.toMatch(/<img[^>]*onerror/i);
		expect(html).toContain('&lt;script&gt;');
		expect(html).toContain('&lt;img');
	});

	it('escapes the text part too', () => {
		expect(text).not.toContain('<script>');
	});

	it('escapes a quote through the normalizer and keeps its line breaks', () => {
		const model = normalizeNotificationModel({
			subject: 's',
			heading: 'h',
			quote: '<img onerror=x>\nline2'
		});
		expect(model.quote).toBe('&lt;img onerror=x&gt;<br />line2');
		expect(model.quote_text).toBe('<img onerror=x>\nline2');
	});
});

describe('ticket-confirmation', () => {
	it('renders every ticket code', () => {
		const { html, text } = byName('ticket-multiple');
		for (const code of ['CMC-4K2P-9XQ1', 'CMC-7B3M-2LZ8', 'CMC-1N9V-6RT4']) {
			expect(html).toContain(code);
			expect(text).toContain(code);
		}
	});

	it('uses plural copy for several tickets', () => {
		const { html } = byName('ticket-multiple');
		expect(html).toContain('3 tickets');
		expect(html).toContain('these codes');
	});

	it('uses singular copy for one ticket', () => {
		const { html } = byName('ticket-single');
		expect(html).toContain('a ticket');
		expect(html).toContain('this code');
		expect(html).not.toContain('these codes');
	});

	it('reports where the buyer sent the money, in both bodies', () => {
		const { html, text } = byName('ticket-single');
		expect(html).toContain('$9.98');
		expect(html).toContain('$4.28');
		expect(text).toContain('To the acts on the bill: $9.98');
		expect(text).toContain('To the Collective: $4.28');
	});

	it('still states a refused share rather than hiding it', () => {
		// The buyer dragged the bar all the way to the acts. Zero to the collective
		// is the outcome the model exists to allow, so the receipt says so — a
		// missing row would read as a rounding error.
		const { text } = byName('ticket-multiple');
		expect(text).toContain('To the acts on the bill: $75.00');
		expect(text).toContain('To the Collective: $0.00');
	});
});

describe('inbox-reply', () => {
	// Regression: the body used to be injected as `{{{body}}}` into an HTML
	// <div>, but the composer is a textarea and the body is plain text — so a
	// two-paragraph reply reached the contact as one run-on line.
	it("keeps the staffer's paragraph break", () => {
		const { text } = byName('inbox-reply');
		expect(text).toContain(
			"wide open right now.\n\nGive me two or three dates that work & I'll hold one for you."
		);
	});

	it('leaves the ampersand and apostrophe unencoded', () => {
		const { text } = byName('inbox-reply');
		expect(text).not.toContain('&amp;');
		expect(text).not.toContain('&#39;');
	});

	it('signs off with the RFC 3676 signature delimiter', () => {
		// `-- ` on its own line is what makes clients collapse the signature and
		// what Postmark's StrippedTextReply cuts on when the contact replies.
		expect(byName('inbox-reply').text).toContain('\n-- \n');
	});
});

describe('contact-alert', () => {
	const { text } = byName('contact-alert');

	it('says what it is and who sent it', () => {
		expect(text).toContain('Charlie Rivera');
		expect(text).toContain('charlie@example.com');
		expect(text).toContain('contact form');
	});

	it("keeps the submitter's line breaks and leaves their text unencoded", () => {
		expect(text).toContain("I run a small folk trio & we're hoping to play a Saturday in March.");
		expect(text).not.toContain('&amp;');
		expect(text).not.toContain('&#39;');
	});

	it('links the thread as a bare URL', () => {
		expect(text).toContain('https://corvmc.org/staff/inbox/thr-1');
	});
});
