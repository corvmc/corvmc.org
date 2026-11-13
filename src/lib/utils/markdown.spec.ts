import { describe, it, expect } from 'vitest';
import {
	sanitizeHtml,
	sanitizeBio,
	renderMarkdown,
	extractHeadings,
	markdownExcerpt,
	renderMessageMarkdown,
	messageBodyIsMarkdown
} from './markdown';

describe('renderMessageMarkdown', () => {
	// Every attack shape against one renderer: the class is user text rendered
	// as HTML, and these are its ways in.
	const attacks = [
		'<script>alert(1)</script>',
		'<img src=x onerror=alert(1)>',
		'<a href="javascript:alert(1)">x</a>',
		'[click](javascript:alert(1))',
		'[click](JaVaScRiPt:alert(1))',
		'[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
		'![x](https://example.com/x.png)',
		'![x" onerror="alert(1)](x)',
		'<div onclick="alert(1)">hi</div>',
		'<iframe src="https://example.com"></iframe>',
		'<style>body{display:none}</style>',
		'[a](https://example.com "t\\" onmouseover=\\"alert(1)")',
		'[<img src=x onerror=alert(1)>](https://example.com)'
	];

	it.each(attacks)('neutralises %s', (input) => {
		const out = renderMessageMarkdown(input);
		expect(out).not.toMatch(/<(script|img|iframe|style|div)\b/i);
		expect(out).not.toMatch(/<[^>]*\son\w+=/i);
		expect(out).not.toMatch(/href="\s*(javascript|data):/i);
	});

	it('shows typed HTML as text rather than dropping it', () => {
		expect(renderMessageMarkdown('<b>hi</b>')).toContain('&lt;b&gt;');
	});

	it('renders emphasis, lists and line breaks', () => {
		const out = renderMessageMarkdown('***Blue Bossa***\nline two\n\n- one\n- two');
		expect(out).toContain('<strong>');
		expect(out).toMatch(/<br\s*\/?>/);
		expect(out).toContain('<li>');
		expect(out).not.toContain('*');
	});

	it('opens external links in a new tab without an opener', () => {
		const out = renderMessageMarkdown('[x](https://example.com)');
		expect(out).toContain('href="https://example.com"');
		expect(out).toContain('target="_blank"');
		expect(out).toContain('rel="noopener noreferrer"');
	});

	it('keeps a site-relative link in the same tab', () => {
		const out = renderMessageMarkdown('[x](/member/groups)');
		expect(out).toContain('href="/member/groups"');
		expect(out).not.toContain('target=');
	});
});

describe('messageBodyIsMarkdown', () => {
	it('is markdown only where everyone writes in the app', () => {
		expect(messageBodyIsMarkdown('group')).toBe(true);
		expect(messageBodyIsMarkdown('direct')).toBe(true);
		expect(messageBodyIsMarkdown('portal')).toBe(true);
		expect(messageBodyIsMarkdown('email')).toBe(false);
		expect(messageBodyIsMarkdown('sms')).toBe(false);
		expect(messageBodyIsMarkdown('band')).toBe(false);
	});
});

// Regression guard: the previous DOMPurify + linkedom setup silently returned
// input UNCHANGED (DOMPurify no-ops on unsupported DOM implementations), so
// these assert actual sanitization happens.

describe('sanitizeHtml', () => {
	it('strips script tags and their content', () => {
		expect(sanitizeHtml('<p>hi</p><script>alert(1)</script>')).toBe('<p>hi</p>');
	});

	it('strips event handlers and javascript: URLs', () => {
		const out = sanitizeHtml('<img src="x" onerror="alert(1)"><a href="javascript:alert(1)">x</a>');
		expect(out).not.toContain('onerror');
		expect(out).not.toContain('javascript:');
	});

	it('keeps common formatting, classes, and safe inline styles', () => {
		const out = sanitizeHtml('<div class="wrap" style="text-align:center"><em>ok</em></div>');
		expect(out).toContain('class="wrap"');
		expect(out).toContain('text-align:center');
		expect(out).toContain('<em>ok</em>');
	});
});

describe('sanitizeBio', () => {
	it('keeps only basic formatting and links', () => {
		const out = sanitizeBio('<p>hi <strong>there</strong></p><div>nope</div><script>x</script>');
		expect(out).toContain('<strong>there</strong>');
		expect(out).not.toContain('<div>');
		expect(out).not.toContain('script');
	});

	it('handles null/undefined', () => {
		expect(sanitizeBio(null)).toBe('');
		expect(sanitizeBio(undefined)).toBe('');
	});
});

describe('renderMarkdown', () => {
	it('renders headings with ids and sanitizes embedded HTML', () => {
		const out = renderMarkdown('## Getting Started\n\n<script>alert(1)</script>text');
		expect(out).toContain('<h2 id="getting-started">');
		expect(out).not.toContain('<script>');
		expect(out).toContain('text');
	});

	it('adds target/rel to external links', () => {
		const out = renderMarkdown('[site](https://example.com)');
		expect(out).toContain('target="_blank"');
		expect(out).toContain('rel="noopener noreferrer"');
	});
});

describe('extractHeadings', () => {
	it('extracts heading ids and levels', () => {
		expect(extractHeadings('# One\n\n## Two Words')).toEqual([
			{ id: 'one', text: 'One', level: 1 },
			{ id: 'two-words', text: 'Two Words', level: 2 }
		]);
	});
});

describe('markdownExcerpt', () => {
	it('reduces markdown to its plain words', () => {
		expect(
			markdownExcerpt('## The night\n\nA **packed** room & [three bands](https://x.test).')
		).toBe('The night A packed room & three bands.');
	});

	it('cuts at a word boundary and marks the cut', () => {
		expect(markdownExcerpt('one two three four five six', 14)).toBe('one two three…');
	});

	it('returns null when there is nothing to show', () => {
		expect(markdownExcerpt(null)).toBeNull();
		expect(markdownExcerpt('   ')).toBeNull();
	});
});
