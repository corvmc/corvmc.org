import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * A moderation report is where a rejection most needs to be readable: the
 * reporter has no other channel, and a silent failure reads as a report that
 * was filed. With a bare input the server's issue set `aria-invalid` and
 * rendered no text at all — the same regression `AdjustCreditsAction` was
 * wrapped in `FormField` to fix.
 */
const issues: Record<string, { path: string[]; message: string }[] | null> = {};

vi.mock('$lib/remote/flags.remote', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => issues[name] ?? null
	});
	return {
		submitFlag: {
			enhance: () => ({ method: 'POST', action: '?/submitFlag' }),
			fields: {
				entityType: field('entityType'),
				entityId: field('entityId'),
				reason: field('reason'),
				description: field('description'),
				allIssues: () => null
			},
			result: undefined
		}
	};
});

// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`; a
// partial mock of this module is a missing-export error at import time rather
// than at the call.
vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const ReportContentAction = (await import('./ReportContentAction.svelte')).default;

const field = (name: string) =>
	document.querySelector(`[role="dialog"] [name="${name}"]`) as unknown as HTMLInputElement;

const open = async (props: Record<string, unknown> = {}) => {
	await render(ReportContentAction, {
		entityType: 'band',
		entityId: 'band-9',
		entityLabel: 'The Setlist',
		...props
	});
	await page.getByRole('button', { name: 'Report' }).click();
	return page.getByRole('dialog');
};

describe('ReportContentAction', () => {
	// Without these the report names no subject and moderation gets a flag on
	// nothing.
	it('carries what is being reported into the form', async () => {
		await open();

		expect(field('entityType').value).toBe('band');
		expect(field('entityId').value).toBe('band-9');
	});

	// The defect this component was converted for.
	it('renders a server issue on the reason as a message', async () => {
		issues.reason = [{ path: ['reason'], message: 'You have already reported this.' }];
		try {
			await open();

			await expect.element(page.getByText('You have already reported this.')).toBeVisible();
		} finally {
			issues.reason = null;
		}
	});

	it('renders a server issue on the details as a message', async () => {
		issues.description = [{ path: ['description'], message: 'Details are too long.' }];
		try {
			await open();

			await expect.element(page.getByText('Details are too long.')).toBeVisible();
		} finally {
			issues.description = null;
		}
	});

	// A caption that names no control is what the hand-rolled `<div class="label">`
	// markup left behind: clicking it focused nothing.
	it('associates both captions with the control they name', async () => {
		await open();

		await expect.element(page.getByLabelText('Reason')).toBeVisible();
		await expect.element(page.getByLabelText('Details (optional)')).toBeVisible();
	});

	// The length caps are the client half of the schema's `max()`. FormField's
	// own textarea drops them, which is why both fields render custom inputs.
	it('keeps the length caps the schema enforces', async () => {
		await open();

		expect(field('reason').maxLength).toBe(100);
		const details = field('description') as unknown as HTMLTextAreaElement;
		expect(details.tagName).toBe('TEXTAREA');
		expect(details.maxLength).toBe(1000);
		expect(details.rows).toBe(3);
	});

	// `canSubmit` reads `reason`, so the binding has to survive the wrapper —
	// without it the submit button never enables and nothing can be reported.
	it('enables the submit once a reason is typed', async () => {
		await open();

		const submit = page.getByRole('button', { name: 'Submit report' });
		await expect.element(submit).toBeDisabled();

		await userEvent.fill(page.getByLabelText('Reason'), 'Impersonation');

		await expect.element(submit).toBeEnabled();
	});
});
