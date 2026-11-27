import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every record keyed by an address is claimed when the address is verified
 * (#757, #3408). A file that marks an address verified, or wires better-auth's
 * verification hook, without going through `claimVerifiedEmail` leaves those
 * records unclaimed.
 */

function sources(dir: string): string[] {
	return readdirSync(dir, { recursive: true, encoding: 'utf8' })
		.filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts') && !f.endsWith('.d.ts'))
		.map((f) => join(dir, f));
}

describe('verification paths', () => {
	it('every file that verifies an address claims by address', () => {
		const offenders = sources('src').filter((file) => {
			const text = readFileSync(file, 'utf8');
			const verifies =
				/emailVerified:\s*true/.test(text) || text.includes('afterEmailVerification');
			return verifies && !text.includes('claimVerifiedEmail');
		});

		expect(offenders).toEqual([]);
	});
});
