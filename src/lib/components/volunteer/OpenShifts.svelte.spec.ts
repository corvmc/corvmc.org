import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { heldRemoteForm } from '#lib/test/fake-remote.svelte.js';

/**
 * The board shows every open shift whatever the member's roles (#3239): a
 * role decides the badge, never whether the shift is on the board.
 */

vi.mock('#lib/remote/volunteer.remote.js', () => ({ claimShift: heldRemoteForm() }));

const OpenShifts = (await import('./OpenShifts.svelte')).default;

function shift(id: string, over: Record<string, unknown> = {}) {
	return {
		id,
		workOrderId: `wo-${id}`,
		roleName: 'Fixture role',
		title: `Shift ${id}`,
		startsAt: new Date('2031-05-10T19:00:00Z'),
		endsAt: new Date('2031-05-10T22:00:00Z'),
		capacity: 2,
		claimed: 0,
		notes: null,
		eventTitle: null,
		myStatus: null,
		mySignupId: null,
		isFull: false,
		interested: false,
		missingCertifications: [],
		...over
	};
}

const row = (c: HTMLElement, id: string) => c.querySelector(`li[data-shift-id="${id}"]`);

describe('OpenShifts', () => {
	it('lists shifts in every role and badges only the member’s roles', async () => {
		const { container } = await render(OpenShifts, {
			shifts: [shift('mine', { interested: true }), shift('other'), shift('another')]
		});

		for (const id of ['mine', 'other', 'another']) expect(row(container, id)).not.toBeNull();
		expect(row(container, 'mine')?.querySelector('[data-testid="your-role"]')).not.toBeNull();
		expect(row(container, 'other')?.querySelector('[data-testid="your-role"]')).toBeNull();
	});

	it('offers no toggle between matches and the whole board', async () => {
		const { container } = await render(OpenShifts, {
			shifts: [shift('mine', { interested: true }), shift('other')]
		});

		// The only buttons are each row's sign-up; nothing in the header filters.
		const rows = container.querySelectorAll('li[data-shift-id]');
		const buttons = container.querySelectorAll('button');
		expect(buttons.length).toBe(rows.length);
	});

	it('keeps a shift needing a clearance on the board with its reason and no sign-up', async () => {
		const { container } = await render(OpenShifts, {
			shifts: [shift('gated', { missingCertifications: [{ id: 'c1', name: 'Sound desk' }] })]
		});

		const gated = row(container, 'gated');
		expect(gated).not.toBeNull();
		expect(gated?.textContent).toContain('Sound desk');
		expect(gated?.querySelector('button')).toBeNull();
	});

	it('leaves out shifts the member is already on', async () => {
		const { container } = await render(OpenShifts, {
			shifts: [shift('taken', { myStatus: 'claimed' }), shift('free')]
		});

		expect(row(container, 'taken')).toBeNull();
		expect(row(container, 'free')).not.toBeNull();
	});
});
