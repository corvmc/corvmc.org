import { redirect } from '@sveltejs/kit';

// A view on Transactions (#2395, #3112).
export function load({ url }) {
	redirect(308, `/staff/system/transactions/payments${url.search}`);
}
