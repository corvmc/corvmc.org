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
	it('lights only Claimed while staff have not confirmed', async () => {
		await render(ShiftProgress, { status: 'claimed' });

		expect(text()).toContain('Claimed');
		expect(text()).toContain('Awaiting staff confirmation.');
		// Booked is present as the next step, but not reached.
		const booked = [...document.querySelectorAll('span')].find((s) => s.textContent === 'Booked')!;
		expect(booked.className).not.toContain('font-bold');
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

	it('puts the shift notes before the reminder line', async () => {
		await render(ShiftProgress, { status: 'confirmed', notes: 'Bring a torch.' });

		expect(text()).toContain('Bring a torch. Reminder lands the day before.');
	});
});
