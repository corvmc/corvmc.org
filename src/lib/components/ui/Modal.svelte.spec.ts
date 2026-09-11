import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import ModalHarness from './Modal.test.svelte';

/**
 * Every action dialog in the app is a `Modal`, so what it gets wrong on open it
 * gets wrong ~56 times. These pin what a non-visual reader is told first. #877.
 */
describe('Modal', () => {
	it('names the close button rather than reading out its glyph', async () => {
		await render(ModalHarness, {});

		await expect.element(page.getByRole('button', { name: 'Close' })).toBeVisible();
		expect(document.querySelector('[role="dialog"] button[aria-label="Close"]')).not.toBeNull();
	});

	// The dialog used to hand focus to the close button, so the first thing
	// announced was "✕, button" instead of the dialog's own name.
	it('opens with focus on the dialog, not on its close button', async () => {
		await render(ModalHarness, {});

		await vi.waitFor(() => {
			const active = document.activeElement;
			expect(active).not.toBeNull();
			expect(active?.getAttribute('role')).toBe('dialog');
		});
	});
});
