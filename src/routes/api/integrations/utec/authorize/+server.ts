import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';
import { randomUUID } from 'crypto';
import { requireCapability } from '$lib/server/authorization';
import { buildAuthorizeUrl, getUtecClientId } from '$lib/server/lock/ultraloc-client';
import { STATE_COOKIE } from '$lib/server/lock/utec-oauth';

// Begins the U-tec OAuth authorization-code flow: redirects the staff user to
// U-tec's consent screen. The callback route completes the exchange.
export const GET: RequestHandler = async ({ url, cookies }) => {
	await requireCapability('lock.manage');

	const clientId = await getUtecClientId();
	if (!clientId) {
		redirect(303, '/staff/settings?utec=missing_config');
	}

	const state = randomUUID();
	cookies.set(STATE_COOKIE, state, {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		maxAge: 600
	});

	const redirectUri = `${url.origin}/api/integrations/utec/callback`;
	redirect(302, buildAuthorizeUrl(clientId, redirectUri, state));
};
