import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Card grammar slot 3: a card's actions are labelled, full width, 44px (#2701).
 * `CardActions` enforces the size in CSS; this keeps the source honest about
 * it and keeps the two card shells rendering their `actions` through it.
 */

const SRC = new URL('.', import.meta.url).pathname;
const SMALL = /\bsize="(xs|sm)"/;

function svelteFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...svelteFiles(path));
		else if (entry.name.endsWith('.svelte')) out.push(path);
	}
	return out;
}

/** The body of each `{#snippet name…}` block, nesting respected. */
function snippetBodies(source: string, name: string): string[] {
	const bodies: string[] = [];
	const open = new RegExp(`\\{#snippet ${name}\\b[^}]*\\}`, 'g');
	for (const match of source.matchAll(open)) {
		const start = match.index + match[0].length;
		const tags = /\{#snippet\b|\{\/snippet\}/g;
		tags.lastIndex = start;
		let depth = 1;
		for (const tag of source.matchAll(tags)) {
			if (tag.index < start) continue;
			depth += tag[0] === '{/snippet}' ? -1 : 1;
			if (depth === 0) {
				bodies.push(source.slice(start, tag.index));
				break;
			}
		}
	}
	return bodies;
}

/** Drops nested snippets: a modal's form renders in a portal, not in the card. */
function withoutNestedSnippets(body: string): string {
	return body.replace(/\{#snippet\b[\s\S]*?\{\/snippet\}/g, '');
}

function cardActionBlocks(source: string): string[] {
	return [...source.matchAll(/<CardActions\b[^>]*>([\s\S]*?)<\/CardActions>/g)].map((m) => m[1]);
}

/** Snippets handed to a card shell as its `actions`, by name or inline. */
function shellActionSnippets(source: string): string[] {
	if (!/<(EntityCard|ReservationCardShell)\b/.test(source)) return [];
	const names = new Set(['actions']);
	for (const m of source.matchAll(/\bactions=\{(?:[^}]*\?\s*)?(\w+)/g)) names.add(m[1]);
	return [...names].flatMap((name) => snippetBodies(source, name));
}

describe('card actions', () => {
	const files = svelteFiles(SRC);

	it('pass no xs or sm size to a card action', () => {
		const offenders = files.flatMap((file) => {
			const source = readFileSync(file, 'utf8');
			const blocks = [...cardActionBlocks(source), ...shellActionSnippets(source)];
			return blocks.some((b) => SMALL.test(withoutNestedSnippets(b))) ? [relative(SRC, file)] : [];
		});
		expect(offenders).toEqual([]);
	});

	it.each([
		'lib/components/ui/entity/EntityCard.svelte',
		'lib/components/reservations/ReservationCardShell.svelte'
	])('%s renders its actions inside CardActions', (file) => {
		const source = readFileSync(join(SRC, file), 'utf8');
		expect(cardActionBlocks(source).some((b) => b.includes('{@render actions()}'))).toBe(true);
	});
});
