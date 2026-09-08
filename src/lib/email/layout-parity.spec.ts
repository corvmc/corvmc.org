import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { EMAIL_LOGO_URL } from './brand';
import { CAMPAIGN_LAYOUT } from '$lib/server/marketing/campaign-layout';

// ---------------------------------------------------------------------------
// Email layout parity
// ---------------------------------------------------------------------------
// The transactional layout and the campaign layout are the same frame written
// twice, and they cannot be merged: the Postmark file is a static asset that
// cannot import TypeScript, and generating it here would invert the source of
// truth and break `email:pull`. So the frame is written down instead.
// ---------------------------------------------------------------------------

const TRANSACTIONAL = 'postmark/templates/_layouts/corvmc-transactional/content.html';

const LAYOUTS = [
	{ path: TRANSACTIONAL, source: readFileSync(TRANSACTIONAL, 'utf8') },
	{ path: 'src/lib/server/marketing/campaign-layout.ts', source: CAMPAIGN_LAYOUT }
];

/**
 * The frame. A change to any of these has to be made in both files, and this
 * is the list that says so — anything absent from it is a part the two layouts
 * are allowed to differ on (see ALLOWED_TO_DIFFER).
 *
 * Deliberately structural rather than byte-exact: font stacks and a couple of
 * dark-mode declarations carry harmless per-layout extras.
 */
const FRAME: { part: string; must: RegExp }[] = [
	{
		part: 'container width',
		must: /width="600" class="container" style="max-width:600px; width:100%;"/
	},
	{ part: 'over-wide image guard', must: /img \{[^}]*max-width:100%/ },
	{
		part: 'header block',
		must: /class="header-bg" style="background-color:#fffbf6; padding:24px 32px 18px; text-align:center;"/
	},
	{ part: 'logo plate cell', must: /class="logo-plate" style="border-radius:8px;"/ },
	{ part: 'logo image', must: /width="72" height="35" alt="Corvallis Music Collective"/ },
	{
		part: 'logo source',
		must: new RegExp(EMAIL_LOGO_URL.replace(/[.?*+^$[\]\\(){}|/-]/g, '\\$&'))
	},
	{
		part: 'tri-stripe cell shape',
		must: /height="4" style="height:4px; background-color:#00859b; font-size:0; line-height:0;"/
	},
	{
		part: 'content padding',
		must: /class="surface[^"]*px-32" style="background-color:#fffbf6; padding:34px 32px 32px;"/
	},
	{
		part: 'footer plate',
		must: /class="footer-bg" style="background-color:#ffe2cd; padding:26px 32px 28px; text-align:center;"/
	},
	{ part: 'fine-print hook', must: /class="footer-fine"/ },
	{ part: 'nonprofit line', must: /Corvallis Music Collective &middot; 501\(c\)\(3\) nonprofit/ },
	{ part: 'address line', must: /6775 SW Philomath Blvd, Corvallis, OR 97333/ },
	{ part: 'contact address', must: /mailto:contact@corvmc\.org/ },
	{ part: 'mobile breakpoint', must: /@media screen and \(max-width:600px\)/ },
	{ part: 'mobile container', must: /\.container \{ width:100% !important; \}/ },
	{
		part: 'mobile inset',
		must: /\.px-32 \{ padding-left:22px !important; padding-right:22px !important; \}/
	},
	{ part: 'dark scheme block', must: /@media \(prefers-color-scheme: dark\)/ },
	{ part: 'dark page', must: /body, \.body-bg \{ background:#161b22 !important; \}/ },
	{ part: 'dark surface', must: /\.surface \{ background:#262d38 !important;/ },
	{ part: 'dark header', must: /\.header-bg \{ background:#161b22 !important; \}/ },
	{
		part: 'dark logo plate',
		must: /\.logo-plate \{ background:#fffbf6 !important; padding:10px 16px !important; \}/
	},
	{ part: 'dark footer', must: /\.footer-bg \{ background:#1d232c !important;/ }
];

/**
 * Real differences, listed so they stop reading as drift. The spec does not
 * look at any of them.
 *
 * `.content` typography is campaign-only because only campaigns render
 * author-written markdown; `.pass-card` / `.quote-bg` are transactional-only
 * for the same reason in reverse.
 */
const ALLOWED_TO_DIFFER = [
	'footer link set — a member dashboard vs an instagram handle, different audiences',
	'opt-out — a real unsubscribe with RFC 8058 headers vs a notification-settings link',
	'dark-mode rules for a component only one layout has',
	'mustache/placeholder syntax — Mustachio fields vs {{CONTENT}} substitution'
];

/** Every frame part the given source is missing, by name. */
export function missingParts(source: string): string[] {
	return FRAME.filter(({ must }) => !must.test(source)).map(({ part }) => part);
}

describe('email layout parity', () => {
	it.each(LAYOUTS)('$path carries the whole frame', ({ source }) => {
		// Named parts, not a diff: the failure has to say which half moved.
		expect(missingParts(source)).toEqual([]);
	});

	it('says out loud what the two are allowed to differ on', () => {
		// A list that empties is a list nobody is maintaining.
		expect(ALLOWED_TO_DIFFER.length).toBeGreaterThan(0);
	});
});

describe('the check itself', () => {
	it('names the part when one layout drops it', () => {
		// #643's actual drift: the campaign layout guarded an over-wide image
		// and the transactional one did not, for long enough that nobody knew.
		const withoutGuard = LAYOUTS[0].source.replace(' max-width:100%;', '');
		expect(missingParts(withoutGuard)).toEqual(['over-wide image guard']);
	});

	it('names the part when a shared measurement is nudged', () => {
		const nudged = LAYOUTS[1].source.replace('padding:26px 32px 28px', 'padding:24px 32px 28px');
		expect(missingParts(nudged)).toEqual(['footer plate']);
	});
});
