const TWILIO_INBOUND_PATH = '/api/inbox/twilio';

/**
 * Kit's CSRF check answers a form POST with no `Origin` before hooks or the
 * route run, and `csrf.trustedOrigins` cannot name an absent origin. Twilio's
 * webhook is exactly that, so it is given its own origin here, ahead of Kit.
 * Only for a signed POST to this path with no `Origin`, which a cross-site
 * browser form cannot be: the route still verifies the signature itself.
 */
export function admitTwilioInbound(request: Request): Request {
	const url = new URL(request.url);
	if (
		request.method !== 'POST' ||
		url.pathname !== TWILIO_INBOUND_PATH ||
		request.headers.has('origin') ||
		!request.headers.has('x-twilio-signature')
	) {
		return request;
	}

	const headers = new Headers(request.headers);
	headers.set('origin', url.origin);
	return new Request(request, { headers });
}
