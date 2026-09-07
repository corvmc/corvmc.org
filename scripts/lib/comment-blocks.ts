import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** A run of consecutive comment lines, measured in lines whatever the syntax. */
export type CommentBlock = { start: number; lines: number };

/**
 * Line-based, not AST-based. A cap on length alone needs no parse, and one
 * scanner covers `.ts` and `.svelte` — including `<!-- -->`, which an AST for
 * either language would miss.
 */
export function commentBlocks(source: string): CommentBlock[] {
	const out: CommentBlock[] = [];
	let openUntil: string | null = null;
	let current: (CommentBlock & { kind: string; end: number }) | null = null;

	source.split('\n').forEach((raw, index) => {
		const line = raw.trim();
		let kind: string | null = null;

		if (openUntil) {
			kind = openUntil;
			if (line.includes(openUntil)) openUntil = null;
		} else if (line.startsWith('/*')) {
			kind = '*/';
			if (!line.includes('*/')) openUntil = '*/';
		} else if (line.startsWith('<!--')) {
			kind = '-->';
			if (!line.includes('-->')) openUntil = '-->';
		} else if (line.startsWith('//')) {
			kind = '//';
		}

		if (!kind) {
			current = null;
			return;
		}
		if (current && current.kind === kind && current.end === index - 1) {
			current.lines += 1;
			current.end = index;
		} else {
			current = { kind, start: index + 1, end: index, lines: 1 };
			out.push(current);
		}
	});

	return out;
}

/** Comment lines living in blocks longer than `cap`, keyed by containing directory. */
export function overCapLinesByDirectory(files: string[], cap: number): Record<string, number> {
	const totals: Record<string, number> = {};
	for (const file of files) {
		const lines = commentBlocks(readFileSync(file, 'utf8'))
			.filter((block) => block.lines > cap)
			.reduce((sum, block) => sum + block.lines, 0);
		if (lines > 0) totals[dirname(file)] = (totals[dirname(file)] ?? 0) + lines;
	}
	return Object.fromEntries(Object.entries(totals).sort(([a], [b]) => a.localeCompare(b)));
}
