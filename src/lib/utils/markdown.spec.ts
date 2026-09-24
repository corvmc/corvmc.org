import { describe, it, expect } from 'vitest';
import {
	sanitizeHtml,
	sanitizeBio,
	renderMarkdown,
	extractHeadings,
	markdownExcerpt
} from './markdown';

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
