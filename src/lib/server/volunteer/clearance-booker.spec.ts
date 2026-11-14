import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from '../../../../scripts/lib/source-files';

/**
 * Which bookings need the Practice space clearance is `CLEARANCE_BOOKER`, and
 * nowhere else (#2808). A clearance reader or orientation raiser that names a
 * booker type of its own can drift from the rest: teaching bookings are exempt
 * from the notice, the tour, the orientation shift and the first-visit mail
 * together, or not at all.
 */
const READS = /\b(holdsPracticeSpaceClearance(Sql)?|raiseOrientationShift)\(/;
const OWN_LITERAL = /bookerType\b[^;\n]{0,25}(===|!==|,)\s*'(user|instructor)'/;

const files = sourceFiles(['src/lib/server/**/*.ts'], new Set())
	.filter((f) => !f.endsWith('.spec.ts'))
	.filter(
		(f) => !f.endsWith('/practice-space-clearance.ts') && !f.endsWith('/orientation-service.ts')
	)
	.filter((f) => READS.test(readFileSync(f, 'utf8')));

describe('clearance rules', () => {
	it('are found, so an empty pass means something', () => {
		expect(files.length).toBeGreaterThanOrEqual(4);
	});

	it.each(files)('%s keys on CLEARANCE_BOOKER, not a booker literal', (file) => {
		const source = readFileSync(file, 'utf8');
		expect(source).toContain('CLEARANCE_BOOKER');
		expect(source).not.toMatch(OWN_LITERAL);
	});
});
