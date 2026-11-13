import { redirect } from '@sveltejs/kit';

/** Sponsorships are listed on the Funding page now (#2622); this keeps old links landing. */
export function load({ url }) {
	redirect(307, `/staff/funding${url.search}`);
}
