import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from '../../../../scripts/lib/source-files';

/**
 * Which bookings need the Practice space clearance is `CLEARANCE_BOOKER`, and
 * nowhere else (#2808). Whether the member is cleared is `practiceSpaceClearance`
 * or its SQL form, and nowhere else (#3028): a reader that checks only the
 * member's own row misses the bandmate path. The notice, the tour, the
 * orientation shift and the first-visit mail move together or not at all.
 */
const READS =
	/\b(practiceSpaceClearance|clearedForPracticeSpaceSql|holdsPracticeSpaceClearance(Sql)?|raiseOrientationShift)\(/;
const DECIDES = /\b(practiceSpaceClearance|clearedForPracticeSpaceSql)\(/;
const OWN_ONLY = /\bholdsPracticeSpaceClearance(Sql)?\(/;
const OWN_LITERAL = /bookerType\b[^;\n]{0,25}(===|!==|,)\s*'(user|instructor)'/;

const all = sourceFiles(['src/lib/server/**/*.ts', 'src/lib/remote/**/*.ts'], new Set())
	.filter((f) => !f.endsWith('.spec.ts'))
	.filter(
		(f) => !f.endsWith('/practice-space-clearance.ts') && !f.endsWith('/orientation-service.ts')
	);
const source = (f: string) => readFileSync(f, 'utf8');
const readers = all.filter((f) => READS.test(source(f)));
const serverReaders = readers.filter((f) => f.includes('/lib/server/'));
const keyed = all.filter((f) => source(f).includes('CLEARANCE_BOOKER'));

describe('clearance rules', () => {
	it('are found, so an empty pass means something', () => {
		expect(serverReaders.length).toBeGreaterThanOrEqual(4);
		expect(keyed.length).toBeGreaterThanOrEqual(4);
	});

	it.each(serverReaders)('%s keys on CLEARANCE_BOOKER, not a booker literal', (file) => {
		expect(source(file)).toContain('CLEARANCE_BOOKER');
		expect(source(file)).not.toMatch(OWN_LITERAL);
	});

	it.each(keyed)('%s decides clearance through practiceSpaceClearance', (file) => {
		expect(source(file)).toMatch(DECIDES);
	});

	it.each(readers)('%s reads no own-only clearance', (file) => {
		expect(source(file)).not.toMatch(OWN_ONLY);
	});
});
