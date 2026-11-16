import { describe, expect, it } from 'vitest';
import { catalogs, variants } from '../../scripts/lib/message-copy';
import { statusLabel } from '#lib/components/ui/StatusBadge.svelte';
import {
	actionStatusSets,
	actionWords,
	type ActionSurface,
	type ActionWords
} from './action-words';

/** The word in any inflection: only its first word inflects ("Checked out"). */
function inflected(word: string): RegExp {
	const [head, ...rest] = word.split(' ');
	const stem = head.replace(/e$/, '');
	const tail = rest.map((w) => `\\s+${w}`).join('');
	return new RegExp(`\\b${stem}(?:e|es|s|ed|ing|led|ling)?${tail}\\b`, 'i');
}

const SURFACES: ActionSurface[] = ['button', 'title', 'toast', 'status', 'filter'];
const rows = Object.entries(actionWords as Record<string, ActionWords>);
const messages: Record<string, unknown> = Object.assign({}, ...catalogs().map((c) => c.messages));

describe('action words (docs/development/writing.md#one-word-per-action)', () => {
	it('gives every value of a listed set a row', () => {
		const missing = Object.entries(actionStatusSets).flatMap(([set, { values }]) =>
			values.map((v) => `${set}.${v}`).filter((key) => !(key in actionWords))
		);
		expect(missing).toEqual([]);
	});

	it('maps only keys the catalog defines', () => {
		const unknown = rows.flatMap(([action, row]) =>
			SURFACES.flatMap((s) => row[s] ?? [])
				.filter((key) => !(key in messages))
				.map((key) => `${action}: ${key}`)
		);
		expect(unknown).toEqual([]);
	});

	it("uses the action's word in every mapped string", () => {
		const off = rows.flatMap(([action, row]) => {
			const word = inflected(row.word);
			return SURFACES.flatMap((s) => row[s] ?? []).flatMap((key) =>
				variants(messages[key])
					.filter((text) => !word.test(text))
					.map((text) => `${action} (${row.word}): ${key} "${text}"`)
			);
		});
		expect(off).toEqual([]);
	});

	it("uses the action's word in the status badge of a badge set", () => {
		const off = Object.entries(actionStatusSets)
			.filter(([, { badge }]) => badge)
			.flatMap(([set, { values }]) =>
				values.flatMap((v) => {
					const row = (actionWords as Record<string, ActionWords>)[`${set}.${v}`];
					const label = statusLabel(v);
					return row && !inflected(row.word).test(label)
						? [`${set}.${v} (${row.word}): "${label}"`]
						: [];
				})
			);
		expect(off).toEqual([]);
	});
});
