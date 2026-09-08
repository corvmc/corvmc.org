import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ConflictWarnings from './ConflictWarnings.svelte';

/**
 * The distinction this component exists to draw.
 *
 * `checkConflicts` returns a typed `conflicts[]` and a free-text
 * `validationWarnings[]`, and the component used to merge them into one
 * `string[]` and one boolean — so a double-booked room and a late finish wore
 * the same yellow and armed the same override. These cases pin them apart.
 */

const BOOKED = {
	type: 'reservation' as const,
	id: 'res-1',
	startsAt: new Date('2026-07-15T17:00:00-07:00'),
	endsAt: new Date('2026-07-15T19:00:00-07:00'),
	label: 'Ada Lovelace'
};

const CLOSED = {
	type: 'closure' as const,
	startsAt: new Date('2026-07-15T00:00:00-07:00'),
	endsAt: new Date('2026-07-16T00:00:00-07:00'),
	label: 'Building maintenance'
};

const TIMES = { date: '2026-07-15', startTime: '18:00', endTime: '19:00' };

function checker(conflicts: unknown[], validationWarnings: string[] = []) {
	return vi.fn(async () => ({ conflicts, validationWarnings }) as never);
}

/** The awaited `checkConflicts` resolves through a boundary, so nothing is in
 * the DOM synchronously. Every case waits on its own assertion rather than on a
 * fixed tick. */
const settled = () =>
	vi.waitFor(() => {
		expect(document.querySelector('[data-conflicts]')).not.toBeNull();
	});

describe('ConflictWarnings', () => {
	it('renders an overlapping booking as an error, naming whose it is', async () => {
		await render(ConflictWarnings, { ...TIMES, checkConflicts: checker([BOOKED]) });
		await settled();

		expect(document.querySelector('.alert-error')?.textContent).toContain('Ada Lovelace');
		expect(document.querySelector('.alert-warning')).toBeNull();
	});

	it('renders a closure as an error too — the space is just as unavailable', async () => {
		await render(ConflictWarnings, { ...TIMES, checkConflicts: checker([CLOSED]) });
		await settled();

		expect(document.querySelector('.alert-error')?.textContent).toContain('Building maintenance');
	});

	it('leaves an advisory alone as a warning', async () => {
		await render(ConflictWarnings, {
			...TIMES,
			checkConflicts: checker([], ['More than 14 days in advance'])
		});
		await settled();

		expect(document.querySelector('.alert-warning')?.textContent).toContain(
			'More than 14 days in advance'
		);
		expect(document.querySelector('.alert-error')).toBeNull();
	});

	it('renders both when both are present, and does not merge them', async () => {
		await render(ConflictWarnings, {
			...TIMES,
			checkConflicts: checker([BOOKED], ['Outside operating hours (09:00 – 22:00)'])
		});
		await settled();

		expect(document.querySelectorAll('.alert-error')).toHaveLength(1);
		expect(document.querySelectorAll('.alert-warning')).toHaveLength(1);
	});

	it('renders nothing at all when the slot is clear', async () => {
		await render(ConflictWarnings, { ...TIMES, checkConflicts: checker([]) });
		await settled();

		expect(document.querySelector('.alert')).toBeNull();
	});

	it('does not call the checker until it has a date and both times', async () => {
		const check = checker([BOOKED]);
		await render(ConflictWarnings, {
			date: '2026-07-15',
			startTime: '',
			endTime: '',
			checkConflicts: check
		});

		expect(check).not.toHaveBeenCalled();
	});
});
