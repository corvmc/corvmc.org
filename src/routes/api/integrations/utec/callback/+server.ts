import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';
import { requireCapability } from '$lib/server/authorization';
import { exchangeAuthorizationCode } from '$lib/server/lock/ultraloc-client';
import { updateSiteConfig } from '$lib/server/site-config/site-config-service';
import { STATE_COOKIE } from '$lib/server/lock/utec-oauth';

// Completes the U-tec OAuth flow: validates the CSRF state, exchanges the code
// for tokens, and persists the refresh token so the lock client can use it.
export const GET: RequestHandler = async ({ url, cookies }) => {
	await requireCapability('lock.manage');

	const expectedState = cookies.get(STATE_COOKIE);
	cookies.delete(STATE_COOKIE, { path: '/' });

	// U-tec reported an error (e.g. the user declined consent).
	if (url.searchParams.get('error')) {
		redirect(303, '/staff/settings?utec=denied');
	}

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	if (!code || !state || !expectedState || state !== expectedState) {
		redirect(303, '/staff/settings?utec=state_error');
	}

	const redirectUri = `${url.origin}/api/integrations/utec/callback`;

	try {
		const { refreshToken } = await exchangeAuthorizationCode(code, redirectUri);
		await updateSiteConfig('integration.utec.refreshToken', refreshToken);
	} catch (err) {
		console.error('U-tec OAuth code exchange failed:', (err as Error).message);
		redirect(303, '/staff/settings?utec=exchange_failed');
	}

	redirect(303, '/staff/settings?utec=connected');
};
