import { safeReturnPath } from '#lib/utils/sign-in.js';

/** Where a guest's tickets show once their account has a verified address. */
const OFFER_RETURN = '/member/events';

/**
 * The create-account link offered to a guest buyer, relative so the email
 * listener can prefix its own site URL. The address rides as a prefill only:
 * `/login` keeps it editable, and tickets link on verification, never here.
 */
export function accountOfferPath(email: string): string {
	const params = new URLSearchParams({ register: '' });
	params.set('email', email.trim());
	const back = safeReturnPath(OFFER_RETURN);
	if (back) params.set('redirect', back);
	return `/login?${params.toString().replace(/^register=(&|$)/, 'register$1')}`;
}
