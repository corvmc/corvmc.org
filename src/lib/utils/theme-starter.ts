// Pure, and deliberately not in `$lib/server/`: the page editor is a component,
// and components may not import from there. Nothing here touches a request, a
// database or a secret — it is a string transform over a stylesheet.

/**
 * A theme's own rules, as editable CSS a band can start from.
 *
 * Themes ship compiled into one stylesheet, which makes them skins a band can
 * only override blindly — you cannot edit what you cannot see. This pulls one
 * theme's block back out and rewrites its selectors to be relative to the
 * container, so what a band gets is the same CSS the theme applies, in the same
 * scope their own CSS is injected into, with the variables named.
 *
 * The stylesheet stays the single source of truth: change a theme and the
 * starting point changes with it.
 */
export function themeStarterCss(themeCss: string, theme: string): string {
	const blocks: string[] = [];
	// `.theme-punk { … }` and `.theme-punk .band-site-hero { … }` alike.
	const pattern = new RegExp(`\\.theme-${theme}\\b([^{]*)\\{([^}]*)\\}`, 'g');
	// Every occurrence, not just the leading one: several themes group their
	// selectors (`.theme-jazz h1, .theme-jazz h2, …`) and stripping only the
	// first leaves the class on the rest, where it can never match from inside
	// the container it names.
	const themeClass = new RegExp(`\\.theme-${theme}\\s*`, 'g');

	for (const match of themeCss.matchAll(pattern)) {
		const selector = match[1].replace(themeClass, '').replace(/\s+/g, ' ').trim();
		const body = match[2].trim();
		if (!body) continue;
		blocks.push(selector ? `${selector} {\n\t${body.replace(/\n\s*/g, '\n\t')}\n}` : body);
	}

	if (blocks.length === 0) return '';

	return `/* Starting point: the "${theme}" theme, as CSS you can edit.
 *
 * Everything here is already scoped to your page, so a bare selector like
 * \`h1\` only ever affects your site. The five variables below are what the
 * blocks read, so changing one recolours everything at once:
 *
 *   --bs-bg       page background      --bs-surface  cards and panels
 *   --bs-text     body text            --bs-muted    secondary text
 *   --bs-accent   links and highlights
 *
 * Useful hooks: .band-site-hero, .band-site-block
 */

${blocks.join('\n\n')}
`;
}
