import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

// Money is Transactions, in the System panel (#3112).
export const load: PageLoad = ({ params, url }) => {
	const rest = params.rest ? `/${params.rest}` : '';
	redirect(308, `/staff/system/transactions${rest}${url.search}`);
};
