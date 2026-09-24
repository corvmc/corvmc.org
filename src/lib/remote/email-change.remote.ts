import { z } from 'zod';
import { invalid } from '@sveltejs/kit';
import { query } from '$app/server';
import { form } from './_remote';
import { can, requireCapability } from '$lib/server/authorization';
import {
	EmailChangeRejectedError,
	cancelEmailChange as cancelEmailChangeService,
	confirmEmailChange as confirmEmailChangeService,
	getEmailChangeRequest as getEmailChangeRequestService,
	getPendingEmailChange as getPendingEmailChangeService,
	requestEmailChange as requestEmailChangeService
} from '$lib/server/user/email-change-service';

// ---------------------------------------------------------------------------
// Staff: propose, resend, cancel
// ---------------------------------------------------------------------------

/**
 * Guarded on `user.read`, like `getRoleCatalog`, so the Account tab still
 * renders for a viewer who may not change the address; `canChange` is what the
 * card hides its actions on. The mutations below are the real guard.
 */
export const getPendingEmailChange = query(z.string().min(1), async (userId) => {
	await requireCapability('user.read');
	if (!(await can('user.setEmail'))) return { canChange: false, pending: null };
	return { canChange: true, pending: await getPendingEmailChangeService(userId) };
});

/** Propose a new address, or resend the link for the pending one. */
export const requestEmailChange = form(
	z.object({ userId: z.string().min(1), email: z.email().max(254) }),
	async ({ userId, email }, issue) => {
		await requireCapability('user.setEmail');
		try {
			await requestEmailChangeService(userId, email);
		} catch (err) {
			// Every refusal is something staff fix by typing a different address.
			if (err instanceof EmailChangeRejectedError) invalid(issue.email(err.message));
			throw err;
		}
		void getPendingEmailChange(userId).refresh();
		return { success: true };
	}
);

export const cancelEmailChange = form(
	z.object({ userId: z.string().min(1) }),
	async ({ userId }) => {
		await requireCapability('user.setEmail');
		await cancelEmailChangeService(userId);
		void getPendingEmailChange(userId).refresh();
		return { success: true };
	}
);

// ---------------------------------------------------------------------------
// Public: the member redeems the link
// ---------------------------------------------------------------------------
// No guard but the token: the member confirming is usually locked out, which
// is why this exists. The query only reads, so a mail client prefetching the
// link changes nothing; the form is the POST that applies it.

export const getEmailChangeRequest = query(z.string().min(1).max(512), async (token) => {
	return getEmailChangeRequestService(token);
});

export const confirmEmailChange = form(
	z.object({ token: z.string().min(1).max(512) }),
	async ({ token }) => confirmEmailChangeService(token)
);
