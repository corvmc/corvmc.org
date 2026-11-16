import { error } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';

/**
 * What must never be done as someone else while an admin views the app as a
 * member (#2847): payments, and password or email changes. A leaf module, so
 * the payment gateway can import it without the rest of the service.
 */

/** The admin behind this request's session, or null. Null outside a request. */
export function impersonatorId(): string | null {
	try {
		return getRequestEvent().locals.session?.impersonatedBy ?? null;
	} catch {
		return null;
	}
}

export function refuseWhileImpersonating(): void {
	if (impersonatorId()) error(403, 'Not available while viewing the app as a member.');
}
