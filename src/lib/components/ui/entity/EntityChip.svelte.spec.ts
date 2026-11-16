import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Harness from './EntityChipHarness.svelte';
import { fakeRef } from '#lib/test/fixtures.js';
import '#lib/test/locators.js';

describe('EntityChip', () => {
	it('derives its link from the viewer rather than a prop', async () => {
		await render(Harness, { ref: fakeRef('member', { id: 'm1' }), panel: 'staff', isStaff: true });
		expect(document.querySelector('a')?.getAttribute('href')).toBe('/staff/members/m1');
	});

	/**
	 * Unreachable keeps the chip shape, so a list of chips stays a list of chips
	 * rather than collapsing into bare text where one entry happens to be gone.
	 * No `href="#"`, which would leave a dead anchor in the accessibility tree.
	 */
	it('renders a span, not a dead anchor, when there is no page to open', async () => {
		await render(Harness, { ref: fakeRef('flag', { id: 'f1' }), isStaff: false, panel: 'member' });
		expect(document.querySelector('a')).toBeNull();
		expect(document.body.textContent).toContain('The Velvet Underground');
	});

	/**
	 * A chip's leading glyph is identity, never a subtype: a band-booked
	 * reservation drawn with a music note reads as *a band*.
	 */
	it('shows the type glyph even for a marked subtype', async () => {
		await render(Harness, { ref: fakeRef('reservation', { id: 'r1', subtype: 'band' }) });
		const svgs = document.querySelectorAll('a svg');
		expect(svgs.length).toBe(1);
	});

	describe('status', () => {
		it('trails a glyph when the record needs attention', async () => {
			await render(Harness, { ref: fakeRef('event', { id: 'e1', status: 'cancelled' }) });
			expect(document.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Cancelled');
		});

		it('says nothing for a record in its expected state', async () => {
			await render(Harness, { ref: fakeRef('event', { id: 'e1', status: 'published' }) });
			expect(document.querySelector('[role="img"]')).toBeNull();
		});

		it('can be turned off entirely', async () => {
			await render(Harness, {
				ref: fakeRef('event', { id: 'e1', status: 'cancelled' }),
				status: false
			});
			expect(document.querySelector('[role="img"]')).toBeNull();
		});
	});

	/**
	 * The preview shows the record's `md` identity, not a bespoke summary: the
	 * point is to show what the reader would find by following the link, and a
	 * second layout for that is a second thing to keep true.
	 */
	describe('preview', () => {
		// Fixture values: what `fakeRef` and the spec put on the record.
		const SUBTITLE = '4 members';
		const chipLink = () => page.getByRole('link').first();
		/**
		 * `.first()` is the chip's own link. Once the preview is open it contains
		 * two more links to the same record, and the pointer can already be over
		 * the chip when this runs — the previous test left it there — so the
		 * preview is sometimes open before the locator resolves. Matching all
		 * three is a strict-mode violation, and which one is hovered does not
		 * matter: they are the same record.
		 */
		it('opens on hover and shows the record identity', async () => {
			await render(Harness, {
				ref: fakeRef('band', { id: 'band-1', slug: 'vu', subtitle: SUBTITLE })
			});
			await chipLink().hover();
			await expect.element(page.getByText(SUBTITLE)).toBeVisible();
		});

		it('opens on keyboard focus, so it is not mouse-only', async () => {
			await render(Harness, {
				ref: fakeRef('band', { id: 'band-1', slug: 'vu', subtitle: SUBTITLE })
			});
			const link = chipLink();
			await link.element().focus();
			await expect.element(page.getByText(SUBTITLE)).toBeVisible();
		});

		/**
		 * On touch the chip's own tap opens the preview instead of navigating, so
		 * without a control inside it a phone could reach the preview and never
		 * the record.
		 */
		it('offers a way through to the record', async () => {
			await render(Harness, { ref: fakeRef('band', { id: 'band-1', slug: 'vu' }) });
			await chipLink().hover();
			// The icon-only Button in the preview: it needs a name of its own.
			const go = page.getByCss('[data-link-preview-content] a.btn[href="/staff/groups/band-1"]');
			await expect.element(go).toBeVisible();
			expect(go.element().getAttribute('aria-label')).toBeTruthy();
		});

		it('can be turned off', async () => {
			await render(Harness, {
				ref: fakeRef('band', { id: 'band-1', slug: 'vu', subtitle: SUBTITLE }),
				preview: false
			});
			await chipLink().hover();
			expect(document.querySelector('[data-link-preview-content]')).toBeNull();
		});
	});
});
