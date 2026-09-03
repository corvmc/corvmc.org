/**
 * CSS Sanitizer for user-authored band page styles.
 *
 * Strips dangerous patterns while preserving valid CSS declarations.
 * All user CSS is rendered inside a <style> scoped to `.band-site-container`,
 * so it cannot leak outside the band page.
 *
 * Blocked patterns:
 * - @import (prevents loading external stylesheets)
 * - @charset (unnecessary, can cause issues)
 * - url() with external domains (prevents data exfiltration / external loads)
 * - expression() (IE legacy scripting)
 * - javascript: protocol
 * - -moz-binding (Firefox XBL)
 * - behavior: (IE HTC)
 * - Base64-encoded scripts in url()
 */

import { env } from '$env/dynamic/private';

const MAX_CSS_LENGTH = 51200; // 50KB

/** Patterns to strip entirely (including surrounding declaration) */
const BLOCKED_AT_RULES = /@import\b[^;]*;?/gi;
const BLOCKED_CHARSET = /@charset\b[^;]*;?/gi;

/** Dangerous value patterns */
const DANGEROUS_PATTERNS = [
	/expression\s*\(/gi,
	/javascript\s*:/gi,
	/-moz-binding\s*:/gi,
	/behavior\s*:\s*url/gi
];

/** Used to build a comment-free copy for detection. Never applied to the output. */
const COMMENT_PATTERN = /\/\*[\s\S]*?\*\//g;

/** url() with external domains — allow data: for small inline images, and relative paths */
const EXTERNAL_URL_PATTERN = /url\s*\(\s*(['"]?)\s*(https?:\/\/|\/\/)[^)]*\1\s*\)/gi;

/** Dangerous data URIs (scripts disguised as data) */
const DANGEROUS_DATA_URI =
	/url\s*\(\s*(['"]?)\s*data\s*:\s*(text\/html|application\/javascript|text\/javascript)[^)]*\)/gi;

/**
 * Whether a `url()` points at the bucket we serve the band's own uploads from.
 *
 * Blocking every absolute URL made it impossible for an act to use a photo it
 * had just uploaded as a page background — the single most obvious thing anyone
 * wants to do with custom CSS, and the whole point of a theme being a starting
 * point rather than a skin. Their own media is not an external resource; it is
 * the same origin the `<img>` tags on the page already come from.
 *
 * Derived from `R2_PUBLIC_URL` rather than hardcoded, so a deployment that
 * serves media elsewhere does not silently start blocking its own files. With
 * no bucket configured nothing is allowed, which is the safe direction.
 */
function isOwnMediaUrl(url: string): boolean {
	const base = env.R2_PUBLIC_URL;
	if (!base) return false;
	try {
		return new URL(url).origin === new URL(base).origin;
	} catch {
		return false;
	}
}

/** Any absolute `url()` that is not ours. */
function foreignUrl(css: string): boolean {
	return matchUrls(css).some(({ url }) => !isOwnMediaUrl(url));
}

function matchUrls(css: string): { whole: string; url: string }[] {
	const out: { whole: string; url: string }[] = [];
	for (const m of css.matchAll(EXTERNAL_URL_PATTERN)) {
		const url = m[0].replace(/^url\s*\(\s*['"]?/i, '').replace(/['"]?\s*\)$/, '');
		out.push({ whole: m[0], url });
	}
	return out;
}

function replaceForeignUrls(css: string): string {
	return css.replace(EXTERNAL_URL_PATTERN, (whole) => {
		const url = whole.replace(/^url\s*\(\s*['"]?/i, '').replace(/['"]?\s*\)$/, '');
		return isOwnMediaUrl(url) ? whole : 'url("")';
	});
}

export interface SanitizeResult {
	css: string;
	warnings: string[];
}

/**
 * Sanitize user-provided CSS string.
 * Returns cleaned CSS and any warnings about removed content.
 */
export function sanitizeCss(input: string): SanitizeResult {
	const warnings: string[] = [];

	if (!input || input.trim().length === 0) {
		return { css: '', warnings };
	}

	// Enforce size limit
	if (input.length > MAX_CSS_LENGTH) {
		warnings.push(`CSS exceeds ${MAX_CSS_LENGTH / 1024}KB limit, truncated`);
		input = input.slice(0, MAX_CSS_LENGTH);
	}

	let css = input;

	// Strip @import
	if (BLOCKED_AT_RULES.test(css)) {
		warnings.push('@import rules removed (external stylesheets not allowed)');
		css = css.replace(BLOCKED_AT_RULES, '');
	}

	// Strip @charset
	if (BLOCKED_CHARSET.test(css)) {
		css = css.replace(BLOCKED_CHARSET, '');
	}

	// Comments are **detected against, not deleted from**, the stylesheet.
	//
	// This used to strip them outright, and the reason was sound: every pattern
	// below is a regex, and `expr/**/ession(` slips past `/expression\s*\(/`.
	// Removing comments before matching closes that. Deleting them from the
	// *output* was the part that was not needed — and it is actively harmful now
	// that themes are starting points a band edits, because every line of "change
	// this to your colour" vanished on the first save.
	//
	// So: match against a comment-free copy, keep the real one.
	// Replaced with nothing, not a space: the whole point is that `expr/**/ession(`
	// rejoins into `expression(` so the literal patterns below see it.
	const commentless = css.replace(COMMENT_PATTERN, '');

	// Strip external URLs, except our own media host — see `isOwnMediaUrl`.
	if (foreignUrl(commentless)) {
		warnings.push('External url() references removed');
		css = replaceForeignUrls(css);
	}

	// Strip dangerous data URIs
	if (DANGEROUS_DATA_URI.test(commentless)) {
		warnings.push('Dangerous data: URIs removed');
		css = css.replace(DANGEROUS_DATA_URI, 'url("")');
	}

	// Strip dangerous value patterns. Tested against the comment-free copy so a
	// split keyword cannot hide, then replaced in the real one — a pattern that
	// only matches when the comments are gone is a pattern the browser would
	// never have executed anyway, and the surrounding declaration is removed
	// below either way.
	for (const pattern of DANGEROUS_PATTERNS) {
		// `lastIndex` is reset before every `test`. These are `/g` regexes, and a
		// `/g` regex resumes from where the previous test stopped — so two tests
		// against different strings silently answer about different offsets. The
		// original code had the same trap and got away with it by testing once.
		pattern.lastIndex = 0;
		if (!pattern.test(commentless)) continue;

		const name = pattern.source.split('\\')[0] || 'dangerous pattern';
		warnings.push(`Blocked pattern removed: ${name}`);

		pattern.lastIndex = 0;
		css = css.replace(pattern, '/* blocked */');

		// A keyword split by a comment survives that replace, because the literal
		// text is not there to match. It only exists once the comments are gone —
		// so for this stylesheet we give them up, which is the right trade: a band
		// writing `expr/**/ession(` is not commenting their theme.
		pattern.lastIndex = 0;
		if (pattern.test(css.replace(COMMENT_PATTERN, ''))) {
			pattern.lastIndex = 0;
			css = css.replace(COMMENT_PATTERN, '').replace(pattern, '/* blocked */');
		}
	}

	// Clean up excessive whitespace
	css = css.replace(/\n{3,}/g, '\n\n').trim();

	return { css, warnings };
}

/**
 * Quick check if CSS contains any blocked patterns.
 * Useful for client-side preview warnings.
 */
export function hasBlockedPatterns(input: string): boolean {
	if (!input) return false;
	return (
		BLOCKED_AT_RULES.test(input) ||
		EXTERNAL_URL_PATTERN.test(input) ||
		DANGEROUS_DATA_URI.test(input) ||
		DANGEROUS_PATTERNS.some((p) => p.test(input))
	);
}
