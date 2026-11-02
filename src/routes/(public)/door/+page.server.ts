import { redirect } from '@sveltejs/kit';
import { signInHref } from '$lib/utils/sign-in';
import type { PageServerLoad } from './$types';

/**
 * The QR code on the back door points here (#2120). A phone camera at the door
 * is often signed out, so that is a 302 to sign-in and back, off the server,
 * rather than a page that redirects once JavaScript boots. Data is the remote
 * query's; this only routes.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user)
		redirect(302, signInHref({ returnTo: '/door', intent: 'Check in at the back door' }));
};
