import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

type Guard = (navigation: {
	cancel: () => void;
	to: { url: URL } | null;
	willUnload: boolean;
	shallow: boolean;
}) => void;

const { captured, formContext } = vi.hoisted(() => ({
	captured: { guard: null as Guard | null },
	formContext: { status: 'dirty', reset: () => {} }
}));

vi.mock('$app/navigation', () => ({
	goto: vi.fn(),
	beforeNavigate: (guard: Guard) => {
		captured.guard = guard;
	}
}));
vi.mock('./Form.svelte', () => ({ getFormContext: () => formContext }));

const FormGuard = (await import('./FormGuard.svelte')).default;

const navigate = (shallow: boolean) => {
	const cancel = vi.fn();
	captured.guard!({
		cancel,
		to: { url: new URL('http://localhost/staff/members/1?tab=account') },
		willUnload: false,
		shallow
	});
	return cancel;
};

describe('FormGuard', () => {
	beforeEach(async () => {
		formContext.status = 'dirty';
		await render(FormGuard);
	});

	it('stops a real navigation away from a dirty form', () => {
		expect(navigate(false)).toHaveBeenCalledOnce();
	});

	// The record pages mirror their tab into the URL with a shallow goto, which
	// fires beforeNavigate. Cancelling it would make every tab click a dialog.
	it('lets a shallow goto through, because the form stays mounted', () => {
		expect(navigate(true)).not.toHaveBeenCalled();
	});
});
