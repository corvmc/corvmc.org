import { expect, type Page } from '@playwright/test';

/**
 * Wait for a success toast — any success toast.
 *
 * These assertions used to match the toast's text (`getByText('Pickup
 * scheduled')`), which made a copy edit a test edit: every `successToast` on
 * every `Action` was pinned by a spec in this directory. Worse, `Action.svelte`
 * falls back to `` `${label} successful` `` when no `successToast` is given, so
 * renaming a *button* moved the toast text too.
 *
 * `svelte-sonner` stamps `data-sonner-toast` and `data-type` on the element it
 * renders (see `node_modules/svelte-sonner/dist/Toast.svelte`), and the Toaster
 * is mounted once in `AppShell.svelte`. That pair is the stable handle: it says
 * the action reported success, which is the only thing these steps were ever
 * checking.
 *
 * Use `expectErrorToast` for the failure path. When a test genuinely needs to
 * distinguish *which* of two success toasts fired, assert on the state the
 * action changed instead — not on its wording.
 */
export function expectSuccessToast(page: Page, timeout = 15000) {
	return expect(page.locator('[data-sonner-toast][data-type="success"]').first()).toBeVisible({
		timeout
	});
}

/** The failure counterpart of {@link expectSuccessToast}. */
export function expectErrorToast(page: Page, timeout = 15000) {
	return expect(page.locator('[data-sonner-toast][data-type="error"]').first()).toBeVisible({
		timeout
	});
}
