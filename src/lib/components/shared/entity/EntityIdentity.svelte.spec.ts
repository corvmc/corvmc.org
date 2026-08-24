import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Harness from './EntityIdentityHarness.svelte';
import { fakeRef } from '$lib/test/fixtures';

describe('EntityIdentity', () => {
	/**
	 * `cell-primary` is `width:100%; max-width:0`, and `truncate` resolves
	 * against that only when the anchor is a *direct* block child of the cell.
	 * Wrap these two in a `<div>` and every list in the staff panel silently
	 * stops truncating — long titles push the row to two lines and the column
	 * budget blows out. Nothing throws, so assert the shape, the same way
	 * `DefinitionList` asserts its dt/dd are direct children.
	 */
	it('renders the anchor and subline as direct children of the cell', async () => {
		render(Harness, { ref: fakeRef('member', { id: 'm1' }) });

		const cell = document.querySelector('td.cell-primary')!;
		const childTags = Array.from(cell.children).map((el) => el.tagName.toLowerCase());
		expect(childTags).toEqual(['a', 'div']);
	});

	it('keeps the truncate class on the anchor itself', async () => {
		render(Harness, { ref: fakeRef('member', { id: 'm1' }) });
		const anchor = document.querySelector('td.cell-primary > a')!;
		expect(anchor.className).toContain('truncate');
	});

	it('omits the subline entirely when there is no qualifier', async () => {
		render(Harness, { ref: fakeRef('member', { id: 'm1', subtitle: null }) });
		const cell = document.querySelector('td.cell-primary')!;
		expect(Array.from(cell.children).map((el) => el.tagName.toLowerCase())).toEqual(['a']);
	});

	/**
	 * A deleted account keeps its row — the history stays honest — but must not
	 * leave a dead anchor in the accessibility tree, which is what the old
	 * `href="#"` did.
	 */
	it('renders a span, not an empty anchor, when the record is gone', async () => {
		render(Harness, { ref: fakeRef('member', { id: null }) });
		const cell = document.querySelector('td.cell-primary')!;
		expect(cell.querySelector('a')).toBeNull();
		expect(cell.querySelector('span')).not.toBeNull();
	});

	it('renders a span when the viewer has no page for the record', async () => {
		// A report is staff-only; a member has nowhere to go.
		render(Harness, { ref: fakeRef('flag', { id: 'f1' }), isStaff: false, panel: 'member' });
		expect(document.querySelector('td.cell-primary a')).toBeNull();
	});

	it('derives the link from the viewer rather than a prop', async () => {
		render(Harness, { ref: fakeRef('member', { id: 'm1' }), panel: 'staff', isStaff: true });
		expect(document.querySelector('td.cell-primary a')?.getAttribute('href')).toBe(
			'/staff/users/m1'
		);
	});

	it('marks a subtype with its glyph and label', async () => {
		render(Harness, { ref: fakeRef('member', { id: 'm1', subtype: 'sustaining' }) });
		expect(document.querySelector('[data-tip]')?.getAttribute('data-tip')).toBe(
			'Sustaining member'
		);
	});

	/**
	 * Subtypes are exception-only. If the ordinary case ever picks up a glyph,
	 * every row in the app gets one and the marker stops meaning anything —
	 * which is the whole reason `user` and `cmc` are absent from the registry.
	 */
	it('leaves the ordinary case unmarked', async () => {
		render(Harness, { ref: fakeRef('member', { id: 'm1', subtype: null }) });
		expect(document.querySelector('[data-tip]')).toBeNull();
	});

	it('leaves an unrecognised subtype unmarked rather than blank', async () => {
		render(Harness, { ref: fakeRef('member', { id: 'm1', subtype: 'nonsense' }) });
		expect(document.querySelector('[data-tip]')).toBeNull();
		expect(document.querySelector('td.cell-primary > a')?.textContent).toContain('Jane Doe');
	});

	/**
	 * The bare cell has nowhere to put a status: it renders two sibling roots and
	 * no wrapper (above), so a third sibling is the one thing this mode cannot
	 * have. `status` is therefore a no-op here, and ui-patterns says so — these
	 * two pin the pair, because the doc claimed a leading glyph for a while and
	 * nothing checked that the component agreed.
	 *
	 * A cell that must show status keeps its own `w-px` column, or passes
	 * `avatar` and lets the status ride it like every other size does.
	 */
	it('draws no status in a bare cell, even when asked for one', async () => {
		render(Harness, {
			ref: fakeRef('reservation', { id: 'r1', status: 'cancelled' }),
			status: true
		});
		const cell = document.querySelector('td.cell-primary')!;
		expect(Array.from(cell.children).map((el) => el.tagName.toLowerCase())).toEqual(['a', 'div']);
		expect(cell.querySelector('[role="img"]')).toBeNull();
	});

	it('rides the media once the cell has an avatar', async () => {
		render(Harness, {
			ref: fakeRef('reservation', { id: 'r1', status: 'cancelled' }),
			status: true,
			avatar: true
		});
		expect(document.querySelector('td.cell-primary [role="img"]')?.getAttribute('aria-label')).toBe(
			'Cancelled'
		);
	});

	/** The md shape is a flex row, so a wrapper here is correct, not a bug. */
	it('wraps in a flex row at size md, where the avatar needs one', async () => {
		render(Harness, { ref: fakeRef('band', { id: 'b1', slug: 'vu' }), size: 'md' });
		const cell = document.querySelector('td.cell-primary')!;
		expect(cell.firstElementChild?.className).toContain('flex');
	});
});

/**
 * `layout.css` sets `text-wrap: balance` on h1–h6 and `text-wrap: pretty` on p,
 * both **unlayered** — and unlayered CSS beats every `@layer`, so no Tailwind
 * utility can override them. The visible effect is that `truncate` silently
 * half-applies on those elements: `overflow` and `text-overflow` take, but
 * `white-space: nowrap` does not, and long titles wrap instead of clipping.
 *
 * Nothing throws, and it only shows up in narrow columns, so pin it here. If a
 * title ever needs to be a heading, put the `truncate` on an inner `<span>` —
 * an inherited value does lose to a direct declaration.
 *
 * Asserted structurally rather than via `getComputedStyle`: this project loads
 * no app stylesheet, so `.truncate` resolves to nothing here regardless. The
 * visual proof lives in the Storybook stories, which do import `layout.css`.
 */
describe('EntityIdentity truncation elements', () => {
	it('never puts truncate directly on a heading or a paragraph', async () => {
		render(Harness, {
			ref: fakeRef('member', { id: 'm1', title: 'A'.repeat(120), subtitle: 'B'.repeat(120) }),
			size: 'md'
		});
		const offenders = [...document.querySelectorAll('.truncate')].filter((el) =>
			['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p'].includes(el.tagName.toLowerCase())
		);
		expect(offenders.map((el) => el.tagName.toLowerCase())).toEqual([]);
	});
});
