import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Both role seeds match on name, so the documentation role must be spelled as
 * production spells it: `Photo/Video` (#1623). A different spelling makes
 * `pnpm volunteer:seed-roles --write` add a second role for the same job.
 */
const SEEDS = ['scripts/seed-volunteer-roles.ts', 'scripts/seed/volunteer.ts'];

describe('the documentation role', () => {
	it.each(SEEDS)('is named as production names it in %s', (file) => {
		const src = readFileSync(file, 'utf8');
		expect(src).toContain("name: 'Photo/Video'");
		expect(src).not.toMatch(/Photos or Video/i);
	});
});
