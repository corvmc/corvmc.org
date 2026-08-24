import { updated } from '$app/state';
import { toast } from 'svelte-sonner';
import { isStaleRemoteResponse } from '$lib/stale-remote-response';

/**
 * Recover a remote-function call that failed because the tab is older than the
 * running deploy (JAVASCRIPT-SVELTEKIT-24).
 *
 * Returns true when it handled the error and a reload is under way, false when
 * the caller should treat the error normally — so a genuinely malformed response
 * from the *current* build still reaches Sentry.
 *
 * `updated.check()` asks the server for the current version rather than reading
 * the cached `updated.current`, which only refreshes on the poll interval and
 * would still be false for a tab that just missed a deploy.
 *
 * Kept out of `+layout.svelte`'s `beforeNavigate` guard on purpose: reloading
 * the moment a new version appears would discard whatever the member has typed.
 * Recovery is only correct here, where the submit has already failed.
 */
export async function recoverFromStaleDeploy(error: unknown): Promise<boolean> {
	if (!isStaleRemoteResponse(error)) return false;
	if (!(await updated.check())) return false;

	toast.info('The site was updated. Reloading…');
	location.reload();
	return true;
}
