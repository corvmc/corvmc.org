import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ShiftProgress from './ShiftProgress.svelte';

/**
 * Extracted from MyShiftCard so the shift's own page can show the same thing:
 * it loaded `status` and rendered it nowhere, so opening a shift told you less
 * about where it stood than the row you clicked (#1066).
 */
const text = () => document.body.textContent ?? '';

describe('ShiftProgress', () => {
	it('says it in words, not twice, while staff have not confirmed', async () => {
		await render(ShiftProgress, { status: 'claimed' });

		// The rail said "Booked" unlit and the sentence then said the same thing
		// — two rows for one bit of state in a 480px column (#1044).
		expect(text()).toContain('Awaiting staff confirmation.');
		expect(text()).not.toContain('Claimed');
	});

	it('lights Booked once the claim is confirmed', async () => {
		await render(ShiftProgress, { status: 'confirmed' });

		const booked = [...document.querySelectorAll('span')].find((s) => s.textContent === 'Booked')!;
		expect(booked.className).toContain('font-bold');
		expect(text()).toContain('Reminder lands the day before.');
	});

	it('withdraws the rail once the shift is worked', async () => {
		await render(ShiftProgress, { status: 'completed' });

		expect(text()).not.toContain('Claimed');
		expect(text()).toContain('Worked.');
	});

	it('gives the shift notes their own line', async () => {
		await render(ShiftProgress, { status: 'confirmed', notes: 'Bring a torch.' });

		// Spliced in front of the fixed copy, an unbounded note and the
		// boilerplate ran together into one paragraph (#1044).
		expect(text()).toContain('Reminder lands the day before.');
		expect(text()).toContain('Bring a torch.');
		expect(text()).not.toContain('Bring a torch. Reminder');
	});
});
