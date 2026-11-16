import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';

/**
 * Every new reservation row goes through `insertReservation`, which writes a
 * club's or committee's booking as already settled. A second insert path would
 * leave that price null, which reads as owed in full (#2616).
 */
const ALLOWED = new Set(['src/lib/server/reservation/insert-reservation.ts']);

const files = sourceFiles(['src/**/*.ts'], ALLOWED).filter((f) => !f.endsWith('.spec.ts'));

describe('reservation inserts', () => {
	it('finds source files to check', () => {
		expect(files.length).toBeGreaterThan(100);
	});

	it('go through insertReservation', () => {
		const hits: string[] = [];
		for (const file of files) {
			readFileSync(file, 'utf8')
				.split('\n')
				.forEach((line, i) => {
					if (/\.insert\(reservation\)/.test(line)) hits.push(`${file}:${i + 1}  ${line.trim()}`);
				});
		}
		expect(hits, hits.join('\n')).toEqual([]);
	});
});
