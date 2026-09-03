import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BAND_THEMES } from '$lib/types/band-page';
import { themeStarterCss } from '$lib/utils/theme-starter';

/**
 * The theme list and the stylesheet are two files that have to agree, and
 * nothing made them. Add a name to `BAND_THEMES` and forget the CSS and a band
 * picks a theme that silently does nothing — the exact "configuration rots"
 * failure `social-prior-art.md` warns about, and the same shape
 * `feature-flags.spec.ts` already guards for flags.
 */
// Read from disk rather than through `?raw`: vite's css plugin claims the
// import in the node project and hands back an empty string, which made every
// assertion below pass against nothing.
const themeCss = readFileSync(
	fileURLToPath(new URL('../../themes/band-site/index.css', import.meta.url)),
	'utf8'
);

describe('band themes', () => {
	it.each(BAND_THEMES)('%s has rules in the stylesheet', (theme) => {
		expect(themeCss).toContain(`.theme-${theme}`);
	});

	it.each(BAND_THEMES)('%s yields a starting point a band can edit', (theme) => {
		// Not just "the class exists" — a theme whose block is empty is as useless
		// to a tinkerer as one that is missing.
		const starter = themeStarterCss(themeCss, theme);
		expect(starter.length).toBeGreaterThan(0);
		expect(starter).not.toContain(`.theme-${theme}`);
	});

	it('has no stylesheet rules for a theme nobody can pick', () => {
		const declared = new Set<string>(BAND_THEMES);
		const inSheet = [...themeCss.matchAll(/\.theme-([a-z0-9-]+)/g)].map((m) => m[1]);
		const orphans = [...new Set(inSheet)].filter((t) => !declared.has(t));
		expect(orphans).toEqual([]);
	});
});
