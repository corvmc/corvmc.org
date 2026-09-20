import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * Readiness before the click. The blockers are fetched when the button
 * renders, not discovered by a publish that fails — and an event announced to
 * the public cannot be un-announced, so the modal has to say what is missing
 * instead of asking for a confirmation it would then refuse.
 */

let blockers: string[] = [];

vi.mock('$lib/remote/events.remote', () => {
	const field = (name: string) => ({
		as: (type: string, value?: unknown) => ({ type, name, value }),
		issues: () => null
	});
	return {
		publishEvent: {
			enhance: () => ({ method: 'POST', action: '?/publishEvent' }),
			fields: { id: field('id'), allIssues: () => null },
			result: undefined
		},
		getEventPublishBlockers: vi.fn(async () => blockers)
	};
});

vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const PublishEventAction = (await import('./PublishEventAction.svelte')).default;

const open = async (missing: string[]) => {
	blockers = missing;
	await render(PublishEventAction, { eventId: 'event-3' });
	await page.getByRole('button', { name: 'Publish' }).first().click();
	return page.getByRole('dialog');
};

/** Action's own footer button, which the trigger shares a name with. */
const submit = () => page.getByRole('dialog').getByRole('button', { name: 'Publish' });

describe('PublishEventAction', () => {
	it('carries the event id into the form', async () => {
		await expect.element(await open([])).toBeVisible();

		const hidden = document.querySelector(
			'[role="dialog"] input[name="id"]'
		) as unknown as HTMLInputElement;
		expect(hidden.type).toBe('hidden');
		expect(hidden.value).toBe('event-3');
	});

	it('asks for a confirmation when nothing is missing', async () => {
		await expect.element(await open([])).toBeVisible();

		await expect.element(page.getByText('visible to the public')).toBeVisible();
		await expect.element(submit()).toBeEnabled();
	});

	/**
	 * Every blocker, not the first one: a staffer who fixes the poster and comes
	 * back to find the venue still missing has been sent round twice by the same
	 * screen.
	 */
	it('lists what is missing and refuses the publish', async () => {
		await expect.element(await open(['No poster', 'No venue'])).toBeVisible();

		await expect.element(page.getByText('Not ready to announce')).toBeVisible();
		await expect.element(page.getByText('No poster')).toBeVisible();
		await expect.element(page.getByText('No venue')).toBeVisible();
		await expect.element(submit()).toBeDisabled();
	});
});
