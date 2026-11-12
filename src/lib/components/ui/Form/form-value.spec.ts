import { describe, expect, it } from 'vitest';
import { formValue } from './form-value';

function data(entries: [string, string][]) {
	const fd = new FormData();
	for (const [name, value] of entries) fd.append(name, value);
	return fd;
}

describe('formValue', () => {
	it('reads a field by key through the form-id suffix kit adds', () => {
		const fd = data([
			['date/1a2b3c/bookAndPayReservation', '2026-11-20'],
			['startTime/1a2b3c/bookAndPayReservation', '18:00']
		]);
		expect(formValue(fd, 'date')).toBe('2026-11-20');
		expect(formValue(fd, 'startTime')).toBe('18:00');
	});

	it('reads through a type prefix', () => {
		expect(formValue(data([['n:hours/1a2b3c/bookAndPayReservation', '2']]), 'hours')).toBe('2');
	});

	it('reads an unsuffixed name', () => {
		expect(formValue(data([['date', '2026-11-20']]), 'date')).toBe('2026-11-20');
	});

	it('does not match a key that only starts with the one asked for', () => {
		expect(
			formValue(data([['startTimeZone/1a2b3c/bookAndPayReservation', 'x']]), 'startTime')
		).toBeNull();
	});
});
