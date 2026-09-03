import { describe, it, expect } from 'vitest';
import { safeFieldPrefix, FIELD_NAME_PATTERN } from './field-names';

/**
 * The rider editor's field names, against the grammar SvelteKit actually
 * applies.
 *
 * This is worth a test rather than a comment because the failure mode is
 * invisible: an illegal name throws `Invalid path` in the browser before the
 * submit leaves the page, so a reviewer sees no error and a tester sees a Save
 * button that silently does nothing. It shipped broken once already, with the
 * user id going straight into the name.
 */
const NAMES = ['label_0', 'inphantom_0_1', 'inmic_12_3', 'kind_0'];

describe('safeFieldPrefix', () => {
	it('makes a hyphenated persona id legal', () => {
		const prefix = safeFieldPrefix('seed-rider-member');
		for (const suffix of NAMES) {
			expect(`${prefix}_${suffix}`).toMatch(FIELD_NAME_PATTERN);
		}
	});

	it('makes a uuid legal, including one that starts with a digit', () => {
		// Half of all uuids do, and the grammar's first character cannot be one.
		for (const id of [
			'd603090a-41f3-497e-a3ff-f770fa299605',
			'4f1e2b3c-0000-1111-2222-333344445555'
		]) {
			expect(`${safeFieldPrefix(id)}_label_0`).toMatch(FIELD_NAME_PATTERN);
		}
	});

	it('keeps two different owners apart', () => {
		expect(safeFieldPrefix('user-a')).not.toBe(safeFieldPrefix('user-b'));
	});

	it('survives the shared-gear sentinel and an empty id', () => {
		expect(`${safeFieldPrefix('shared')}_label_0`).toMatch(FIELD_NAME_PATTERN);
		expect(`${safeFieldPrefix('')}_label_0`).toMatch(FIELD_NAME_PATTERN);
	});

	// The guard rail for the guard rail: if this stops failing, the pattern above
	// has drifted from the one SvelteKit enforces and the tests prove nothing.
	it('is testing a pattern that a raw uuid genuinely fails', () => {
		expect('d603090a-41f3-497e-a3ff-f770fa299605_label_0').not.toMatch(FIELD_NAME_PATTERN);
	});
});
