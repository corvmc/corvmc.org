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
			['date/abc123', '2026-11-20'],
			['startTime/abc123', '18:00']
		]);
		expect(formValue(fd, 'date')).toBe('2026-11-20');
		expect(formValue(fd, 'startTime')).toBe('18:00');
	});

	it('reads through a type prefix', () => {
		expect(formValue(data([['n:hours/abc123', '2']]), 'hours')).toBe('2');
	});

	it('reads an unsuffixed name', () => {
		expect(formValue(data([['date', '2026-11-20']]), 'date')).toBe('2026-11-20');
	});

	it('does not match a key that only starts with the one asked for', () => {
		expect(formValue(data([['startTimeZone/abc123', 'x']]), 'startTime')).toBeNull();
	});
});
