import type { BandEpk } from '#lib/types/band-page.js';

/**
 * The address a contact-form enquiry is emailed to, besides the roster's own
 * notifications. The press kit's booking contact wins; the profile's contact
 * email is the fallback for bands that set it before the press kit existed.
 * Delivery and the profile page's read-only line both read this, so the page
 * cannot name an address the form does not send to.
 */
export function enquiryDestination(
	epk: Pick<BandEpk, 'bookingContact'> | null | undefined,
	profileContact: unknown
): { email: string; source: 'booking' | 'profile' } | null {
	const booking = epk?.bookingContact?.email?.trim();
	if (booking) return { email: booking, source: 'booking' };
	const profile = (profileContact as { email?: unknown } | null)?.email;
	if (typeof profile === 'string' && profile.trim()) {
		return { email: profile.trim(), source: 'profile' };
	}
	return null;
}
