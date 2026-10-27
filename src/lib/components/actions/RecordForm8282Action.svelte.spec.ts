import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * The due date is an IRS deadline derived from an instant, so it must be
 * shown as the club's calendar day: an evening retirement in Corvallis is
 * already the next day in UTC, and the late direction is the costly one.
 */

const field = (name: string) => ({
	as: (type: string, value?: unknown) => ({ type, name, value }),
	issues: () => null
});

vi.mock('$lib/remote/inventory.remote', () => ({
	recordForm8282: {
		enhance: () => ({ method: 'POST', action: '?/recordForm8282' }),
		fields: { id: field('id'), note: field('note'), allIssues: () => null },
		result: undefined
	}
}));

vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const RecordForm8282Action = (await import('./RecordForm8282Action.svelte')).default;

describe('RecordForm8282Action', () => {
	it('shows the due date as the club-time day, not the UTC day', async () => {
		// 7pm PDT on Oct 27 is 02:00 UTC on Oct 28.
		await render(RecordForm8282Action, {
			assetId: 'asset-1',
			dueBy: new Date('2026-10-28T02:00:00Z')
		});
		await page.getByRole('button', { name: 'Record 8282' }).first().click();

		const dialog = page.getByRole('dialog');
		await expect.element(dialog.getByText('2026-10-27')).toBeVisible();
		expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('2026-10-28');
	});
});
