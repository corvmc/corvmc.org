import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';

/**
 * A balance is owed on a confirmed or a completed booking (#3003), so a write
 * that settles one (`paidAt`, or `cashDueCents: 0`) and is gated on stored
 * status reads `payableStatusSql()`. Gated on `confirmed` alone, a member's
 * money for a completed session matched no row and was kept unrecorded.
 */
const SETTLES = /\bpaidAt:\s*(?!null)|\bcashDueCents:\s*0\b/;
const CONFIRMED_ONLY = /eq\(reservation\.status,\s*'confirmed'\)/;

/** Each `.update(reservation)` statement, up to the `;` that ends its line. */
export function settlingUpdates(source: string): string[] {
	const found: string[] = [];
	for (const m of source.matchAll(/\.update\(reservation\)[\s\S]*?;$/gm)) {
		if (SETTLES.test(m[0])) found.push(m[0]);
	}
	return found;
}

const files = sourceFiles(['src/lib/**/*.ts'], new Set()).filter((f) => !f.endsWith('.spec.ts'));

describe('writes that settle a balance accept every payable status', () => {
	it('finds the settling writes', () => {
		const all = files.flatMap((f) => settlingUpdates(readFileSync(f, 'utf8')));
		expect(all.length).toBeGreaterThan(4);
	});

	it('catches a confirmed-only gate and passes the shared one', () => {
		const gated = `.update(reservation).set({
			// a comment; with a semicolon
			paidAt: new Date() })
			.where(and(eq(reservation.id, id), eq(reservation.status, 'confirmed')));`;
		expect(settlingUpdates(gated).some((u) => CONFIRMED_ONLY.test(u))).toBe(true);
		const shared = gated.replace(/eq\(reservation\.status, 'confirmed'\)/, 'payableStatusSql()');
		expect(settlingUpdates(shared).some((u) => CONFIRMED_ONLY.test(u))).toBe(false);
	});

	it('none gates on confirmed alone', () => {
		const found = files.flatMap((f) =>
			settlingUpdates(readFileSync(f, 'utf8'))
				.filter((u) => CONFIRMED_ONLY.test(u))
				.map((u) => `${f}: ${u.split('\n')[0]}`)
		);
		expect(found, `use payableStatusSql() from payment-due:\n${found.join('\n')}`).toEqual([]);
	});
});
