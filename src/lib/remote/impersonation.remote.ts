import { z } from 'zod';
import { error, isHttpError, redirect } from '@sveltejs/kit';
import { getRequestEvent, query } from '$app/server';
import { form } from './_remote';
import { auth } from '#lib/server/auth.js';
import { requireUser } from '#lib/server/authorization.js';
import { assertMayImpersonate, isAdmin } from '#lib/server/impersonation/impersonation-service.js';

/**
 * View the app as a member (#2847). Admins only, on the role rather than a
 * capability; see `impersonation-service.ts` for the rules.
 */

/** The banner's read: who is being viewed as, and by whom. Null when nobody is. */
export const getImpersonation = query(async () => {
	const { locals } = getRequestEvent();
	if (!locals.user || !locals.impersonator) return null;
	return {
		memberId: locals.user.id,
		memberName: locals.user.name,
		adminName: locals.impersonator.name
	};
});

/** Whether the "View as member" button shows on this member's record. */
export const canImpersonate = query(z.string().min(1), async (memberId) => {
	const viewer = requireUser();
	if (getRequestEvent().locals.impersonator) return false;
	if (viewer.id === memberId || !(await isAdmin(viewer.id))) return false;
	return !(await isAdmin(memberId));
});

export const startImpersonation = form(z.object({ userId: z.string().min(1) }), async (data) => {
	const viewer = requireUser();
	if (getRequestEvent().locals.impersonator) error(400, 'Stop viewing as a member first.');
	await assertMayImpersonate(viewer.id, data.userId);
	try {
		await auth.api.startImpersonating({
			headers: getRequestEvent().request.headers,
			body: { userId: data.userId }
		});
	} catch (err) {
		if (isHttpError(err)) throw err;
		error(403, err instanceof Error ? err.message : 'Not permitted');
	}
	redirect(303, '/member');
});

export const stopImpersonation = form('unchecked', async () => {
	requireUser();
	if (!getRequestEvent().locals.impersonator) error(400, 'Not viewing as a member.');
	const { memberId } = await auth.api.stopImpersonating({
		headers: getRequestEvent().request.headers
	});
	redirect(303, `/staff/members/${memberId}`);
});
