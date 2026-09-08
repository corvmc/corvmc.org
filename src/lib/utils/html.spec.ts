import { describe, it, expect } from 'vitest';
import { escapeHtml, escapeHtmlWithBreaks, unescapeHtml } from './html';

describe('escapeHtml', () => {
	it('escapes the five HTML-significant characters', () => {
		expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
	});

	it('escapes ampersands before the entities it introduces', () => {
		expect(escapeHtml('&lt;')).toBe('&amp;lt;');
	});

	it('leaves ordinary text alone', () => {
		expect(escapeHtml('7:00 PM – 9:00 PM')).toBe('7:00 PM – 9:00 PM');
	});
});

describe('escapeHtmlWithBreaks', () => {
	it('converts newlines to <br /> after escaping', () => {
		expect(escapeHtmlWithBreaks('a\nb')).toBe('a<br />b');
	});

	it('handles CRLF', () => {
		expect(escapeHtmlWithBreaks('a\r\nb')).toBe('a<br />b');
	});

	it('does not let injected markup through', () => {
		expect(escapeHtmlWithBreaks('<img onerror=x>\nnext')).toBe('&lt;img onerror=x&gt;<br />next');
	});
});
describe('unescapeHtml', () => {
	it('round-trips whatever escapeHtml produced', () => {
		const raw = `Tom & Jerry play "Misty" <live> at Bob's`;
		expect(unescapeHtml(escapeHtml(raw))).toBe(raw);
	});

	it('decodes &amp; last, so an escaped entity stays literal', () => {
		expect(unescapeHtml('&amp;lt;')).toBe('&lt;');
	});

	it('decodes both apostrophe forms and a non-breaking space', () => {
		expect(unescapeHtml('Bob&#39;s and Ann&#x27;s')).toBe("Bob's and Ann's");
		expect(unescapeHtml('a&nbsp;b')).toBe('a b');
	});

	it('leaves ordinary text alone', () => {
		expect(unescapeHtml('7:00 PM – 9:00 PM')).toBe('7:00 PM – 9:00 PM');
	});
});
