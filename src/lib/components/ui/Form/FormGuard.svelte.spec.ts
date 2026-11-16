import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';

type Navigation = {
	cancel: () => void;
	to: { url: URL } | null;
	willUnload: boolean;
	shallow: boolean;
};
type Guard = (navigation: Navigation) => void;

const { captured, formContext } = vi.hoisted(() => ({
	captured: { guards: [] as Guard[] },
	formContext: { status: 'dirty', reset: () => {} }
}));

vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	beforeNavigate: (guard: Guard) => {
		captured.guards.push(guard);
	}
}));
vi.mock('./Form.svelte', () => ({ getFormContext: () => formContext }));

const FormGuard = (await import('./FormGuard.svelte')).default;

const navigate = (shallow = false) => {
	const navigation: Navigation = {
		cancel: vi.fn(),
		to: { url: new URL('http://localhost/staff/members/1?tab=account') },
		willUnload: false,
		shallow
	};
	for (const guard of captured.guards) guard(navigation);
	return navigation.cancel;
};

const openDialogs = () => document.querySelectorAll('dialog[open]').length;

describe('FormGuard', () => {
	beforeEach(() => {
		captured.guards = [];
		formContext.status = 'dirty';
	});

	it('stops a real navigation away from a dirty form', async () => {
		await render(FormGuard);

		expect(navigate()).toHaveBeenCalled();
	});

	// The record pages mirror their tab into the URL with a shallow goto, which
	// fires beforeNavigate. Cancelling it would make every tab click a dialog.
	it('lets a shallow goto through, because the form stays mounted', async () => {
		await render(FormGuard);

		expect(navigate(true)).not.toHaveBeenCalled();
	});

	it('guards an editor not built on Form through its own dirty check', async () => {
		formContext.status = 'idle';
		let dirty = false;
		await render(FormGuard, { dirty: () => dirty });

		expect(navigate()).not.toHaveBeenCalled();
		dirty = true;
		expect(navigate()).toHaveBeenCalled();
	});

	it('asks once when two dirty forms share a page', async () => {
		await render(FormGuard);
		await render(FormGuard);

		navigate();
		await tick();

		expect(openDialogs()).toBe(1);
	});
});
