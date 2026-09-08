import { BAND_THEMES, type BandThemeValue } from '$lib/types/band-page';
import { themeOfStarter, themeStarterCss } from '$lib/utils/theme-starter';

/**
 * The two states a band's styling can be in, and the moves between them.
 *
 * A theme used to be a skin: the `.theme-punk` class stayed on the container
 * and whatever a band wrote layered on top of it. That made the CSS box a place
 * to override rules nobody could read — delete a rule you copied out of the
 * theme and nothing happens, because the theme's own is still underneath.
 *
 * So there are exactly two states now:
 *
 *   picked  — `theme` is one of `BAND_THEMES`. The class applies and the pane
 *             shows that theme's rules, read-only. Nothing of the band's is in
 *             play, so there is nothing to lose.
 *   forked  — `theme` is `'custom'`. No class applies at all, and the CSS in
 *             the pane is the entire look. Deleting a rule removes it.
 *
 * Pure on purpose: this is the part worth pinning down, and a spec should not
 * need a browser to do it.
 */
export interface ThemeState {
	theme: BandThemeValue;
	customCss: string;
}

function isPickedTheme(theme: string): boolean {
	return (BAND_THEMES as readonly string[]).includes(theme);
}

/**
 * What the CSS pane shows for a given state.
 *
 * Picked: the theme's own rules, which is what makes a theme legible rather
 * than a black box. Forked: the band's CSS, verbatim.
 */
export function paneCss(state: ThemeState, themeSheet: string): string {
	return state.theme === 'custom' ? state.customCss : themeStarterCss(themeSheet, state.theme);
}

/**
 * Take the current theme over: its rules become the band's own CSS and the
 * class stops applying, so the pane and the page finally agree.
 */
export function fork(state: ThemeState, themeSheet: string): ThemeState {
	if (state.theme === 'custom') return state;
	return { theme: 'custom', customCss: themeStarterCss(themeSheet, state.theme) };
}

/**
 * Pick a theme, discarding whatever was in the pane.
 *
 * Only ever reached through a confirmation when the band has CSS of their own —
 * `needsConfirm` below is what the panel asks first. Picking from a picked
 * state destroys nothing, since the pane was the theme's.
 */
export function pickTheme(theme: BandThemeValue): ThemeState {
	// The band's own CSS goes; from here the class carries the look.
	return { theme, customCss: '' };
}

/** Would picking `next` throw away work the band did? */
export function needsConfirm(state: ThemeState, next: BandThemeValue): boolean {
	return state.theme === 'custom' && next !== 'custom' && state.customCss.trim() !== '';
}

/**
 * Bring a row written under the old layering model into the fork model.
 *
 * `theme: 'punk'` plus custom CSS meant "punk, then these overrides". Folding
 * punk's rules in ahead of the overrides preserves the cascade exactly — same
 * rules, same order, same scope — so the page renders identically. What changes
 * is that the band can now see the half of it that was invisible.
 *
 * Nothing is written until they save, so a row only converts when someone opens
 * the editor and saves it.
 */
export function foldLegacy(state: ThemeState, themeSheet: string): ThemeState {
	if (state.theme === 'custom' || !state.customCss.trim()) return state;
	const starter = themeStarterCss(themeSheet, state.theme);
	if (!starter) return state;
	return { theme: 'custom', customCss: `${starter}\n\n${state.customCss}` };
}

/**
 * How the theme control names the current state.
 *
 * A forked stylesheet still remembers where it came from, in the header comment
 * `themeStarterCss` writes, so it can say so rather than going anonymous the
 * moment it is edited.
 */
export function themeLabel(state: ThemeState): string {
	if (state.theme !== 'custom') {
		return state.theme.charAt(0).toUpperCase() + state.theme.slice(1);
	}
	const origin = themeOfStarter(state.customCss);
	return origin && isPickedTheme(origin)
		? `Custom (from ${origin.charAt(0).toUpperCase() + origin.slice(1)})`
		: 'Custom';
}
