import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { foldLegacy, fork, needsConfirm, paneCss, pickTheme, themeLabel } from './theme-fork';
import { themeClass } from '$lib/utils/theme-starter';

/**
 * Read from disk rather than through `?raw`: vite's css plugin claims that
 * import in the node project and hands back an empty string, which would make
 * every assertion here pass against nothing. Same reason as
 * `band-themes.spec.ts`.
 */
const sheet = readFileSync(
	fileURLToPath(new URL('../../../../lib/themes/band-site/index.css', import.meta.url)),
	'utf8'
);

describe('the CSS pane', () => {
	it('shows a picked theme its own rules, not an empty box', () => {
		const css = paneCss({ theme: 'punk', customCss: '' }, sheet);
		expect(css).toContain('--bs-accent: #ff2d55');
		// Scoped by the container it is injected into, so the class must be gone.
		expect(css).not.toContain('.theme-punk');
	});

	it('shows a forked stylesheet the band its own CSS, untouched', () => {
		const css = paneCss({ theme: 'custom', customCss: 'h1 { color: red }' }, sheet);
		expect(css).toBe('h1 { color: red }');
	});
});

describe('forking a theme', () => {
	it('drops the class and seeds the CSS with what the class was doing', () => {
		const next = fork({ theme: 'punk', customCss: '' }, sheet);
		expect(next.theme).toBe('custom');
		// Everything punk did is now readable and editable.
		expect(next.customCss).toContain('--bs-accent: #ff2d55');
		expect(next.customCss).toContain('font-family');
	});

	it('is a no-op on an already-forked stylesheet', () => {
		const state = { theme: 'custom' as const, customCss: 'h1 { color: red }' };
		expect(fork(state, sheet)).toBe(state);
	});
});

describe('picking a theme', () => {
	it('clears the CSS, because from here the class carries the look', () => {
		expect(pickTheme('jazz')).toEqual({ theme: 'jazz', customCss: '' });
	});

	it('asks first only when there is work to lose', () => {
		expect(needsConfirm({ theme: 'custom', customCss: 'h1{}' }, 'jazz')).toBe(true);
		// Nothing of the band's is in play in either of these.
		expect(needsConfirm({ theme: 'custom', customCss: '  ' }, 'jazz')).toBe(false);
		expect(needsConfirm({ theme: 'punk', customCss: '' }, 'jazz')).toBe(false);
	});
});

describe('a row written under the old layering model', () => {
	it('folds the theme in ahead of the overrides, preserving the cascade', () => {
		const folded = foldLegacy({ theme: 'punk', customCss: 'h1 { color: lime }' }, sheet);
		expect(folded.theme).toBe('custom');
		// Order is the whole point: punk first, the band's override after, exactly
		// as source order resolved them when the class was still applied.
		expect(folded.customCss.indexOf('--bs-accent: #ff2d55')).toBeLessThan(
			folded.customCss.indexOf('color: lime')
		);
	});

	it('leaves a theme with no CSS of its own alone', () => {
		const state = { theme: 'punk' as const, customCss: '' };
		expect(foldLegacy(state, sheet)).toBe(state);
	});

	it('leaves an already-forked row alone', () => {
		const state = { theme: 'custom' as const, customCss: 'h1{}' };
		expect(foldLegacy(state, sheet)).toBe(state);
	});
});

describe('the label on the control', () => {
	it('names a picked theme', () => {
		expect(themeLabel({ theme: 'punk', customCss: '' })).toBe('Punk');
	});

	it('remembers where a forked stylesheet came from', () => {
		const forked = fork({ theme: 'punk', customCss: '' }, sheet);
		expect(themeLabel(forked)).toBe('Custom (from Punk)');
	});

	it('says plain Custom for CSS this editor did not write', () => {
		expect(themeLabel({ theme: 'custom', customCss: 'h1 { color: red }' })).toBe('Custom');
	});
});

describe('the container class', () => {
	it('applies the theme it is given', () => {
		expect(themeClass('punk', null)).toBe('theme-punk');
		expect(themeClass('custom', 'h1{}')).toBe('theme-custom');
	});

	it('floors an empty custom row at the default theme rather than no styling', () => {
		// `.band-site-container` carries no colours of its own — the themes do — so
		// `theme-custom` with nothing in it would render unstyled.
		expect(themeClass('custom', '')).toBe('theme-default');
		expect(themeClass('custom', null)).toBe('theme-default');
	});
});
