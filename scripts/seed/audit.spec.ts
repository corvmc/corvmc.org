import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Source-text assertions, like `usage-personas.spec.ts`: importing a seeder
 * opens D1 at module scope. The log links a row's booking, band, bandmate, loan
 * and clearance by the id in its details, so a literal id there names a record
 * that does not exist and its chip never renders (#3060).
 */
const source = readFileSync(new URL('audit.ts', import.meta.url), 'utf8');
const LINKED_IDS = [
	'reservationId',
	'groupId',
	'bandmateUserId',
	'loanId',
	'clearanceId',
	'certificationId'
];

describe('audit seed', () => {
	it('takes every linked id from a seeded record, never a literal', () => {
		const literal = LINKED_IDS.filter((key) => new RegExp(`\\b${key}: ['"\`]`).test(source));
		expect(literal).toEqual([]);
	});

	it('seeds the booking cleared through a band and the loan requested without clearance', () => {
		for (const action of [
			'reservation.cleared_through_band',
			'equipment_loan.requested_without_clearance'
		]) {
			expect(source).toContain(`action: '${action}'`);
		}
	});
});
