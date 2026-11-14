import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sourceFiles } from './lib/source-files';

/**
 * "Owes money" is `confirmedUnpaidSql` / `paymentDueSql` in SQL (decision
 * 0080) and `owesMoney` in TypeScript (#2991). A query that compares
 * `cashDueCents` to zero itself is a second definition, and drifts on refunds,
 * event holds and never-priced bookings. Checking `cashDueCents` for null to
 * mean "nothing committed yet" is a different question and passes.
 */
const OWN_RULE =
	/\b(gt|gte|ne)\(\s*(reservation|r)\.cashDueCents\b|\$\{reservation\.cashDueCents\}\s*[<>!]/;

const ALLOWED = new Set(['src/lib/server/reservation/payment-due.ts']);

const files = sourceFiles(['src/lib/server/**/*.ts', 'src/lib/remote/**/*.ts'], ALLOWED).filter(
	(f) => !f.endsWith('.spec.ts')
);

export function decidesOwing(line: string): boolean {
	return OWN_RULE.test(line);
}

describe('one rule for owing money', () => {
	it('catches the shapes it replaced and passes the rest', () => {
		for (const own of [
			'gt(reservation.cashDueCents, 0),',
			'or(isNull(reservation.cashDueCents), gt(reservation.cashDueCents, 0)),',
			'sql`${reservation.cashDueCents} > 0`'
		])
			expect(decidesOwing(own), own).toBe(true);
		for (const other of [
			'isNull(reservation.cashDueCents),',
			'cashDueCents: reservation.cashDueCents,',
			'.set({ cashDueCents: 0 })'
		])
			expect(decidesOwing(other), other).toBe(false);
	});

	it('no server query decides owing for itself', () => {
		expect(files).toContain('src/lib/server/reservation/reservation-service.ts');
		const found: string[] = [];
		for (const file of files) {
			readFileSync(file, 'utf8')
				.split('\n')
				.forEach((line, i) => {
					if (decidesOwing(line)) found.push(`${file}:${i + 1}  ${line.trim()}`);
				});
		}
		expect(
			found,
			`use confirmedUnpaidSql / paymentDueSql from $lib/server/reservation/payment-due:\n${found.join('\n')}`
		).toEqual([]);
	});
});
