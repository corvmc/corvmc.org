import { describe, expect, it } from 'vitest';
import {
	ADULT_AGE_YEARS,
	adultBirthDateCutoff,
	isMinor,
	parseBirthDateInput,
	toBirthDateInput
} from './age';

// Fixed "now" so a birthday passing while CI runs cannot flip a case — the
// weekday- and date-dependent reds this repo has collected all came from
// asserting against the wall clock.
const NOW = new Date('2026-09-07T12:00:00Z');

function birthday(offsetYears: number, offsetDays = 0): Date {
	const d = new Date(NOW.getTime());
	d.setFullYear(d.getFullYear() - offsetYears);
	d.setDate(d.getDate() + offsetDays);
	return d;
}

describe('isMinor', () => {
	it('is false for a member who has given no date — most of them', () => {
		expect(isMinor(null, NOW)).toBe(false);
		expect(isMinor(undefined, NOW)).toBe(false);
	});

	it('is false for an unparseable date rather than throwing', () => {
		expect(isMinor(new Date('not a date'), NOW)).toBe(false);
	});

	it('is true for someone comfortably under 18', () => {
		expect(isMinor(birthday(16), NOW)).toBe(true);
	});

	it('is false for someone comfortably over 18', () => {
		expect(isMinor(birthday(30), NOW)).toBe(false);
	});

	it('turns them loose on their eighteenth birthday, not the day after', () => {
		expect(isMinor(birthday(ADULT_AGE_YEARS), NOW)).toBe(false);
		expect(isMinor(birthday(ADULT_AGE_YEARS, 1), NOW)).toBe(true);
	});

	it('re-applies itself as time passes — the point of storing a date', () => {
		const seventeenthBirthday = birthday(17);
		expect(isMinor(seventeenthBirthday, NOW)).toBe(true);

		const inTwoYears = new Date(NOW.getTime());
		inTwoYears.setFullYear(inTwoYears.getFullYear() + 2);
		expect(isMinor(seventeenthBirthday, inTwoYears)).toBe(false);
	});
});

describe('adultBirthDateCutoff', () => {
	it('is exactly eighteen years back, not 18 × 365 days', () => {
		// 2026 → 2008. A day-count cutoff drifts by the leap days in between,
		// which is enough to misclassify somebody on their birthday.
		const cutoff = adultBirthDateCutoff(NOW);
		expect(cutoff.getUTCFullYear()).toBe(NOW.getUTCFullYear() - ADULT_AGE_YEARS);
		expect(cutoff.getUTCMonth()).toBe(NOW.getUTCMonth());
		expect(cutoff.getUTCDate()).toBe(NOW.getUTCDate());
	});
});

describe('parseBirthDateInput', () => {
	it('reads a date input', () => {
		expect(parseBirthDateInput('2008-09-07', NOW)?.toISOString()).toBe('2008-09-07T00:00:00.000Z');
	});

	it('drops an empty, malformed or unparseable value rather than throwing', () => {
		// It rides along on a profile save; a typo must not cost the member the
		// rest of the form.
		for (const value of ['', null, undefined, 'yesterday', '07/09/2008', '2008-13-45']) {
			expect(parseBirthDateInput(value, NOW)).toBeNull();
		}
	});

	it('drops a future date and an implausible one', () => {
		expect(parseBirthDateInput('2030-01-01', NOW)).toBeNull();
		expect(parseBirthDateInput('1850-01-01', NOW)).toBeNull();
	});

	it('round-trips through the input format', () => {
		const parsed = parseBirthDateInput('1994-02-28', NOW);
		expect(toBirthDateInput(parsed)).toBe('1994-02-28');
	});

	it('renders an absent or invalid date as the empty field', () => {
		expect(toBirthDateInput(null)).toBe('');
		expect(toBirthDateInput(undefined)).toBe('');
		expect(toBirthDateInput(new Date('nope'))).toBe('');
	});
});
