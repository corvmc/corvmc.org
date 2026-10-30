import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Harness from './VolunteerPanelHarness.svelte';

/**
 * The roster row truncates what staff choose on: roles collapse to `+N` and
 * availability has no column at all (#1790). The panel is the whole entry.
 */
const roles = ['Booking Lead', 'Door', 'Merch', 'Sound', 'Stage Crew', 'Zine'];
const availability =
	'Weekday evenings after 6, most Saturdays, never the first Sunday of the month.';

const volunteer = {
	userId: 'u-1',
	personId: 'u-1',
	email: 'robin@example.com',
	memberStatus: 'member' as const,
	member: {
		type: 'member' as const,
		id: 'u-1',
		title: 'Robin Vale',
		subtitle: 'robin@example.com',
		pronouns: 'they/them'
	},
	status: 'active' as const,
	isAdult: false,
	roleNames: roles,
	minutes: 330,
	availability,
	phone: '541-555-0100',
	since: new Date('2026-03-04T12:00:00Z'),
	claim: null,
	lapse: null
};

describe('VolunteerPanel', () => {
	it('shows every role, the full availability, and contact in full', async () => {
		await render(Harness, { volunteer });
		const dialog = page.getByRole('dialog', { name: 'Robin Vale' });
		await expect.element(dialog).toBeVisible();

		for (const role of roles) await expect.element(dialog.getByText(role)).toBeVisible();
		await expect.element(dialog.getByText(availability)).toBeVisible();
		await expect.element(dialog.getByText('they/them')).toBeVisible();
		await expect.element(dialog.getByText('541-555-0100')).toBeVisible();
		await expect.element(dialog.getByText('5.5 hrs')).toBeVisible();
		await expect.element(dialog.getByText('Under 18')).toBeVisible();
	});

	it("carries the row's action and a link through to the full record", async () => {
		await render(Harness, { volunteer });
		const dialog = page.getByRole('dialog', { name: 'Robin Vale' });

		await expect.element(dialog.getByRole('button', { name: 'Log Hours' })).toBeVisible();
		await expect
			.element(dialog.getByRole('link', { name: 'Open Record' }))
			.toHaveAttribute('href', '/staff/members/u-1?tab=volunteer');
	});

	it('opens as a side panel rather than a centred dialog', async () => {
		await render(Harness, { volunteer });
		await expect.element(page.getByRole('dialog', { name: 'Robin Vale' })).toHaveClass(/modal-end/);
	});

	it('says so when no roles were picked and no availability was given', async () => {
		await render(Harness, {
			volunteer: { ...volunteer, roleNames: [], availability: null, phone: null }
		});
		const dialog = page.getByRole('dialog', { name: 'Robin Vale' });

		await expect.element(dialog.getByText('None picked')).toBeVisible();
		await expect.element(dialog.getByText('Not given')).toBeVisible();
	});
});
