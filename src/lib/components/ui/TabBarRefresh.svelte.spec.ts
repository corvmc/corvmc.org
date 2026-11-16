import { page } from 'vitest/browser';
import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import Harness from './TabBarRefreshBoundary.test.svelte';

function deferred<T>() {
	let resolve = (_: T) => {};
	const promise = new Promise<T>((r) => (resolve = r));
	return { promise, resolve };
}

const macrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Regression for #2433: a notification's `refreshAll()` during a member record
 * load ended in `effect_update_depth_exceeded` and the staff layout's failed
 * boundary. New tab objects with unchanged keys must not re-register the triggers:
 * that write merges into the open refresh, which derives the tabs again.
 */
it('survives a refresh landing while the first load is still pending', async () => {
	const onerror = vi.fn();
	const first = { tabs: deferred<number>(), other: deferred<number>() };
	const { component } = await render(Harness, {
		onerror,
		tabsRead: first.tabs.promise,
		otherRead: first.other.promise
	});
	await macrotask();

	const refreshed = { tabs: deferred<number>(), other: deferred<number>() };
	component.refresh(refreshed.tabs.promise, refreshed.other.promise);
	await macrotask();

	refreshed.tabs.resolve(1);
	await macrotask();
	expect(onerror).not.toHaveBeenCalled();

	refreshed.other.resolve(1);
	await expect.element(page.getByRole('tab').first()).toMatchTextContent('a 1');
	expect(onerror).not.toHaveBeenCalled();
});
