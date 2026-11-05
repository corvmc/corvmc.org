import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND } from './brand';
import { CAMPAIGN_LAYOUT } from '#lib/server/marketing/campaign-layout.js';

// ---------------------------------------------------------------------------
// Email palette guard
// ---------------------------------------------------------------------------
// The Postmark templates are static files that can't import brand.ts, and the
// campaign layout is a separate TypeScript module. Both used to carry their own
// independently-drifting generic palette. These tests keep them honest without
// locking down layout — no occurrence counts, no element positions, so ordinary
// design tweaks don't fail them.
// ---------------------------------------------------------------------------

const TEMPLATE_ROOT = 'postmark/templates';

/** Neutrals that are legitimately not brand colors. */
const ALLOWED_EXTRA = ['#ffffff', '#000000'];

function flatten(value: unknown): string[] {
	if (typeof value === 'string') return [value.toLowerCase()];
	if (value && typeof value === 'object') return Object.values(value).flatMap(flatten);
	return [];
}

const PALETTE = new Set([...flatten(BRAND), ...ALLOWED_EXTRA]);

function templateHtmlFiles(): { path: string; source: string }[] {
	const files: { path: string; source: string }[] = [];
	for (const entry of readdirSync(TEMPLATE_ROOT, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const dirs =
			entry.name === '_layouts'
				? readdirSync(join(TEMPLATE_ROOT, '_layouts')).map((d) =>
						join(TEMPLATE_ROOT, '_layouts', d)
					)
				: [join(TEMPLATE_ROOT, entry.name)];
		for (const dir of dirs) {
			const path = join(dir, 'content.html');
			// Text-only templates (the two-way, replyable ones) have no HTML part
			// and so no palette to police.
			if (!existsSync(path)) continue;
			files.push({ path, source: readFileSync(path, 'utf8') });
		}
	}
	return files;
}

const SOURCES = [
	...templateHtmlFiles(),
	{ path: 'src/lib/server/marketing/campaign-layout.ts', source: CAMPAIGN_LAYOUT }
];

describe('email palette', () => {
	it.each(SOURCES)('$path uses only brand colors', ({ source }) => {
		const used = [...source.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase());
		const offenders = [...new Set(used)].filter((hex) => !PALETTE.has(hex));
		expect(offenders).toEqual([]);
	});

	// Only the two layouts carry the chrome; the inner templates are body-only.
	const LAYOUTS = SOURCES.filter((s) => s.path.includes('_layouts') || s.path.includes('campaign'));

	it.each(LAYOUTS)('$path carries the tri-stripe in order', ({ source }) => {
		// Teal → goldenrod → red-orange. The strongest brand recall device, and
		// easy to reorder by accident when editing table rows.
		expect(source).toMatch(
			new RegExp(`${BRAND.teal}[\\s\\S]*${BRAND.goldenrod}[\\s\\S]*${BRAND.redOrange}`, 'i')
		);
	});
});
