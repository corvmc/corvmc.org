import { redirect } from '@sveltejs/kit';

/** The volunteer report moved into Reports (#2075). The range rides along. */
export function load({ url }) {
	redirect(308, `/staff/reports/volunteering${url.search}`);
}
