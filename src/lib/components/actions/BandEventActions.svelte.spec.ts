import { page } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

/**
 * Four band-panel event actions with near-identical staff twins sitting in the
 * same folder. The twins post to `events.remote` and would 403 here, because
 * these are guarded by `requireGroupRole({ slug }, 'admin')` — which resolves
 * the band from a `slug` the staff forms do not carry. Both halves are pinned
 * together because they share one remote module, and both fail the same
 * invisible way: an admin's own button refusing their own event.
 */

const field = (name: string) => ({
	as: (type: string, value?: unknown) => ({ type, name, value }),
	issues: () => null
});

const remoteForm = (name: string, names: string[]) => ({
	enhance: () => ({ method: 'POST', action: `?/${name}` }),
	fields: {
		...Object.fromEntries(names.map((n) => [n, field(n)])),
		allIssues: () => null
	},
	result: undefined
});

const bandFields = ['slug', 'eventId'];

vi.mock('$lib/remote/band-events.remote', () => ({
	publishBandEvent: remoteForm('publishBandEvent', bandFields),
	unpublishBandEvent: remoteForm('unpublishBandEvent', bandFields),
	cancelBandEventForm: remoteForm('cancelBandEventForm', bandFields),
	removeBandEventPoster: remoteForm('removeBandEventPoster', bandFields)
}));

// The staff twins, mocked so a component that imports the wrong module fails on
// the handler it posts to rather than on a missing export.
vi.mock('$lib/remote/events.remote', () => ({
	publishEvent: remoteForm('publishEvent', ['id']),
	unpublishEvent: remoteForm('unpublishEvent', ['id']),
	cancelEvent: remoteForm('cancelEvent', ['id']),
	deleteEvent: remoteForm('deleteEvent', ['id'])
}));

// `FormGuard`, which `<Form>` always imports, reaches for `beforeNavigate`; a
// partial mock of this module is a missing-export error at import time rather
// than at the call.
vi.mock('$app/navigation', () => ({
	invalidateAll: vi.fn(),
	goto: vi.fn(),
	beforeNavigate: vi.fn()
}));

const BandPublishEventAction = (await import('./BandPublishEventAction.svelte')).default;
const BandUnpublishEventAction = (await import('./BandUnpublishEventAction.svelte')).default;
const BandCancelEventAction = (await import('./BandCancelEventAction.svelte')).default;
const RemoveEventPosterAction = (await import('./RemoveEventPosterAction.svelte')).default;

const CASES = [
	{ Component: BandPublishEventAction, label: 'Publish', handler: '?/publishBandEvent' },
	{ Component: BandUnpublishEventAction, label: 'Unpublish', handler: '?/unpublishBandEvent' },
	{ Component: BandCancelEventAction, label: 'Cancel Event', handler: '?/cancelBandEventForm' },
	{ Component: RemoveEventPosterAction, label: 'Remove Poster', handler: '?/removeBandEventPoster' }
] as const;

const hidden = (name: string) =>
	document.querySelector(`[role="dialog"] input[name="${name}"]`) as unknown as HTMLInputElement;

describe('band-panel event actions', () => {
	for (const { Component, label, handler } of CASES) {
		const open = async () => {
			await render(Component, { slug: 'the-rockers', eventId: 'event-11' });
			await page.getByRole('button', { name: label }).first().click();
			return page.getByRole('dialog');
		};

		it(`${label} posts to the band panel's own handler`, async () => {
			await expect.element(await open()).toBeVisible();

			const form = document.querySelector('[role="dialog"] form') as HTMLFormElement;
			expect(form.getAttribute('action')).toBe(handler);
		});

		// The guard resolves the band from `slug`; without it the event id names a
		// row the caller may have no claim on, and the handler refuses.
		it(`${label} carries both the band and the event`, async () => {
			await expect.element(await open()).toBeVisible();

			expect(hidden('slug').type).toBe('hidden');
			expect(hidden('slug').value).toBe('the-rockers');
			expect(hidden('eventId').value).toBe('event-11');
		});
	}
});
