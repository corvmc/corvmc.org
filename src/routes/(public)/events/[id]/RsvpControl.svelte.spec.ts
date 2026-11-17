import { page } from 'vitest/browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { toast } from 'svelte-sonner';
import '#lib/test/locators.js';

import { fakeQuery, heldRemoteForm } from '#lib/test/fake-remote.svelte.js';

const status = fakeQuery({
	state: 'open' as string,
	reason: null,
	attendee: { name: 'Fixture Member', email: 'member@example.test' }
});
const confirm = heldRemoteForm();

vi.mock('$app/env/public', async () => (await import('#lib/testing/env-mock.js')).envMock({}));
vi.mock('svelte-sonner', () => ({
	toast: Object.assign(vi.fn(), { success: vi.fn(), info: vi.fn(), error: vi.fn() })
}));
vi.mock('#lib/report-error.js', () => ({ reportError: vi.fn() }));
vi.mock('#lib/remote/event-rsvp.remote.js', () => ({
	getRsvpStatus: status,
	confirmRsvp: confirm,
	withdrawRsvp: heldRemoteForm()
}));

const RsvpControl = (await import('./RsvpControl.svelte')).default;

const going = () => page.getByTestId('rsvp-going');
const rsvp = () => page.getByCss('button[type="submit"]');

beforeEach(async () => {
	await confirm.settleAll();
	status.resource.set({ ...status.resource.current, state: 'open' });
	vi.mocked(toast.error).mockClear();
});

describe('RSVP before the server answers', () => {
	it('shows the member as going while the RSVP is in flight', async () => {
		await render(RsvpControl, { eventId: 'evt-1', eventTitle: 'Fixture Night' });
		await rsvp().click();

		await expect.element(going()).toBeVisible();
		expect(confirm.held).toHaveLength(1);
	});

	it('goes back to the RSVP button and says why when the server refuses', async () => {
		await render(RsvpControl, { eventId: 'evt-1', eventTitle: 'Fixture Night' });
		await rsvp().click();
		await expect.element(going()).toBeVisible();

		confirm.held[0].reject(Object.assign(new Error('closed'), { status: 409 }));

		await expect.element(rsvp()).toBeVisible();
		await expect.element(going()).not.toBeInTheDocument();
		await vi.waitFor(() => expect(toast.error).toHaveBeenCalled());
	});
});
