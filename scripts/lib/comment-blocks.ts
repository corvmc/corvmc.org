import { readFileSync } from 'node:fs';

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

/** Files carrying at least one comment block longer than `cap`. */
export function filesOverCap(files: string[], cap: number): string[] {
	return files.filter((file) =>
		commentBlocks(readFileSync(file, 'utf8')).some((block) => block.lines > cap)
	);
}
