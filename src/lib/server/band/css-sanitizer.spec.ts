import { describe, it, expect } from 'vitest';
import { sanitizeCss, hasBlockedPatterns } from './css-sanitizer';
import { themeStarterCss } from '$lib/utils/theme-starter';

describe('sanitizeCss', () => {
	it('passes through valid CSS unchanged', () => {
		const input = `.band-site-container { color: red; font-size: 16px; }`;
		const { css, warnings } = sanitizeCss(input);
		expect(css).toBe(input);
		expect(warnings).toHaveLength(0);
	});

	it('strips @import rules', () => {
		const input = `@import url("https://evil.com/steal.css");\n.foo { color: red; }`;
		const { css, warnings } = sanitizeCss(input);
		expect(css).not.toContain('@import');
		expect(css).toContain('.foo { color: red; }');
		expect(warnings.some((w) => w.includes('@import'))).toBe(true);
	});

	it('strips @charset rules', () => {
		const input = `@charset "UTF-8";\n.foo { color: red; }`;
		const { css } = sanitizeCss(input);
		expect(css).not.toContain('@charset');
		expect(css).toContain('.foo { color: red; }');
	});

	it('strips external url() references', () => {
		const input = `.foo { background: url("https://evil.com/tracker.png"); }`;
		const { css, warnings } = sanitizeCss(input);
		expect(css).not.toContain('evil.com');
		expect(css).toContain('url("")');
		expect(warnings.some((w) => w.includes('External url()'))).toBe(true);
	});

	it('allows relative url() references', () => {
		const input = `.foo { background: url("/images/bg.png"); }`;
		const { css, warnings } = sanitizeCss(input);
		expect(css).toContain('/images/bg.png');
		expect(warnings).toHaveLength(0);
	});

	it('allows data: URIs for images', () => {
		const input = `.foo { background: url("data:image/png;base64,abc123"); }`;
		const { css, warnings } = sanitizeCss(input);
		expect(css).toContain('data:image/png');
		expect(warnings).toHaveLength(0);
	});

	it('strips dangerous data: URIs (text/html)', () => {
		const input = `.foo { background: url("data:text/html,<script>alert(1)</script>"); }`;
		const { css, warnings } = sanitizeCss(input);
		expect(css).not.toContain('text/html');
		expect(warnings.some((w) => w.includes('data: URI'))).toBe(true);
	});

	it('strips expression()', () => {
		const input = `.foo { width: expression(document.body.clientWidth); }`;
		const { css } = sanitizeCss(input);
		expect(css).not.toContain('expression');
		expect(css).toContain('/* blocked */');
	});

	it('strips javascript: protocol', () => {
		const input = `.foo { background: url("javascript:alert(1)"); }`;
		const { css } = sanitizeCss(input);
		expect(css).not.toContain('javascript');
	});

	it('strips -moz-binding', () => {
		const input = `.foo { -moz-binding: url("evil.xml#xbl"); }`;
		const { css } = sanitizeCss(input);
		expect(css).not.toContain('-moz-binding');
	});

	// Comments used to be deleted outright. They are now detected *against* and
	// kept, because a theme a band starts from is mostly comments explaining
	// what to change — and stripping them made every starter theme useless after
	// one save. The protection is unchanged: detection still runs on a
	// comment-free copy, which is the part that mattered.
	it('keeps comments in a clean stylesheet', () => {
		const input = `.foo { /* change this to your colour */ color: red; }`;
		const { css, warnings } = sanitizeCss(input);
		expect(css).toContain('change this to your colour');
		expect(css).toContain('color: red');
		expect(warnings).toEqual([]);
	});

	it('still catches a keyword split by a comment', () => {
		// The reason comments were stripped in the first place: `expr/**/ession(`
		// slips past a literal regex. Detection runs on a comment-free copy, so
		// this is caught — and the declaration is neutralised in the output.
		const { css, warnings } = sanitizeCss(`.foo { width: expr/**/ession(alert(1)); }`);
		expect(css).not.toMatch(/ession\s*\(/);
		expect(warnings.length).toBeGreaterThan(0);
	});

	it('catches javascript: hidden behind a comment', () => {
		const { css } = sanitizeCss(`.foo { background: java/**/script:alert(1); }`);
		expect(css).not.toMatch(/script\s*:alert/);
	});

	it('truncates CSS exceeding 50KB', () => {
		const input = 'a'.repeat(60000);
		const { css, warnings } = sanitizeCss(input);
		expect(css.length).toBeLessThanOrEqual(51200);
		expect(warnings.some((w) => w.includes('50KB'))).toBe(true);
	});

	it('returns empty string for empty input', () => {
		expect(sanitizeCss('').css).toBe('');
		expect(sanitizeCss('   ').css).toBe('');
	});
});

describe('hasBlockedPatterns', () => {
	it('returns true for @import', () => {
		expect(hasBlockedPatterns('@import url("x");')).toBe(true);
	});

	it('returns true for expression()', () => {
		expect(hasBlockedPatterns('width: expression(1)')).toBe(true);
	});

	it('returns false for clean CSS', () => {
		expect(hasBlockedPatterns('.foo { color: red; }')).toBe(false);
	});

	it('returns false for empty input', () => {
		expect(hasBlockedPatterns('')).toBe(false);
	});
});

describe('themeStarterCss', () => {
	const SHEET = `
.theme-default { --bs-bg: #fff; }

/* Punk — high contrast */
.theme-punk {
	--bs-bg: #0a0a0a;
	--bs-accent: #ff2d55;
	font-family: 'Impact', sans-serif;
}

.theme-punk .band-site-hero {
	border-bottom: 4px solid var(--bs-accent);
}

.theme-punk a {
	color: var(--bs-accent);
}
`;

	it('pulls out only the named theme', () => {
		const css = themeStarterCss(SHEET, 'punk');
		expect(css).toContain('#ff2d55');
		expect(css).not.toContain('#fff');
	});

	it('rewrites selectors relative to the container', () => {
		// A band's CSS is injected inside `.band-site-container { … }`, so a rule
		// they copy must not carry `.theme-punk` — that class is on the container
		// itself and would never match from inside it.
		const css = themeStarterCss(SHEET, 'punk');
		expect(css).not.toContain('.theme-punk');
		expect(css).toContain('.band-site-hero {');
		expect(css).toContain('a {');
	});

	it('names the variables, because nobody can guess them', () => {
		const css = themeStarterCss(SHEET, 'punk');
		for (const v of ['--bs-bg', '--bs-text', '--bs-accent', '--bs-surface', '--bs-muted']) {
			expect(css).toContain(v);
		}
	});

	it('survives sanitizing, comments and all', () => {
		// The whole point. A starter theme is mostly comments, and this is the
		// round trip that used to destroy them.
		const { css, warnings } = sanitizeCss(themeStarterCss(SHEET, 'punk'));
		expect(css).toContain('Starting point');
		expect(css).toContain('--bs-accent');
		expect(warnings).toEqual([]);
	});

	it('returns nothing for a theme with no rules', () => {
		expect(themeStarterCss(SHEET, 'nonexistent')).toBe('');
	});
});
