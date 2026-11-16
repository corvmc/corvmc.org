import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every section of a console states its own state (#2692): each `<InfoCard>`
 * under a console route passes `state`, so the page can be scanned without
 * being read. A card listed below shows its state another way, or has none.
 */
const ROOT = join(import.meta.dirname, '..');
const CONSOLES = [
	'src/routes/staff/events/[id]/production',
	'src/routes/staff/system',
	'src/routes/staff/inbox/channels',
	'src/routes/staff/volunteering/settings'
];

/** `file › title expression` → why it passes no `state`. */
const ALLOWED: Record<string, string> = {
	'src/routes/staff/events/[id]/production/+page.svelte › m.staff_production_title()':
		'its own header carries the status badge',
	'src/routes/staff/events/[id]/production/+page.svelte › m.staff_events_id_production_tech_riders_title()':
		'its own header carries the missing-rider badge',
	'src/routes/staff/events/[id]/production/RunOfShowPanel.svelte › m.staff_events_id_production_run_of_show_panel_add_set_title()':
		'a form for a new row, not a part of the record'
};

/** The opening tag, read to its closing `>` at brace depth zero. */
function openingTags(source: string): string[] {
	const tags: string[] = [];
	for (const match of source.matchAll(/<InfoCard\b/g)) {
		let depth = 0;
		let i = match.index;
		for (; i < source.length; i++) {
			const c = source[i];
			if (c === '{') depth++;
			else if (c === '}') depth--;
			else if (c === '>' && depth === 0) break;
		}
		tags.push(source.slice(match.index, i + 1));
	}
	return tags;
}

function stateless(): string[] {
	return CONSOLES.flatMap((dir) =>
		readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' })
			.filter((f) => f.endsWith('.svelte'))
			.flatMap((f) => {
				const file = relative(ROOT, join(ROOT, dir, f));
				return openingTags(readFileSync(join(ROOT, file), 'utf8'))
					.filter((tag) => !/\sstate=|\{state\}/.test(tag))
					.map((tag) => `${file} › ${/title=\{([^}]*)\}/.exec(tag)?.[1] ?? '?'}`);
			})
	);
}

describe('console sections', () => {
	const found = stateless();

	it('state their own state, or are allowlisted with a reason', () => {
		expect(found.filter((key) => !(key in ALLOWED))).toEqual([]);
	});

	it('keeps no allowlist entry that now passes state', () => {
		expect(Object.keys(ALLOWED).filter((key) => !found.includes(key))).toEqual([]);
	});
});
