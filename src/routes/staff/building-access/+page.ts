import { redirect } from '@sveltejs/kit';

// Building access is a Practice space settings tab (#3102). The query carries
// the U-tec sign-in's result; the browser re-applies a fragment such as
// `#active-codes` to the new URL.
export function load({ url }) {
	redirect(308, `/staff/reservations/settings/building-access${url.search}`);
}
