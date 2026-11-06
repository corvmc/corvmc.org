import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '#lib/test/locators.js';

/**
 * A moderation report is where a rejection most needs to be readable: the
 * reporter has no other channel, and a silent failure reads as a report that
 * was filed. With a bare input the server's issue set `aria-invalid` and
 * rendered no text at all — the same regression `AdjustCreditsAction` was
 * wrapped in `FormField` to fix.
 */
const issues: Record<string, { path: string[]; message: string }[] | null> = {};

vi.mock('#lib/remote/flags.remote.js', () => {
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
	refreshAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const ReportContentAction = (await import('./ReportContentAction.svelte')).default;

const open = async (props: Record<string, unknown> = {}) => {
	const { locator } = await render(ReportContentAction, {
		entityType: 'band_profile',
		entityId: 'band-9',
		entityLabel: 'The Setlist',
		...props
	});
	await locator.getByRole('button').click();
	return page.getByRole('dialog');
};

describe('ReportContentAction', () => {
	// The defect this component was converted for.
	it('renders a server issue on the reason as a message', async () => {
		const message = 'You have already reported this.';
		issues.reason = [{ path: ['reason'], message }];
		try {
			const dialog = await open();

			await expect.element(dialog.getByText(message)).toBeVisible();
		} finally {
			issues.reason = null;
		}
	});

	// `canSubmit` reads `reason`, so the binding has to survive the wrapper —
	// without it the submit button never enables and nothing can be reported.
	it('enables the submit once a reason is typed', async () => {
		const dialog = await open();

		const submit = dialog.getByCss('button[type="submit"]');
		await expect.element(submit).toBeDisabled();

		await userEvent.fill(page.getByLabelText('Reason'), 'Impersonation');

		await expect.element(submit).toBeEnabled();
	});
});
