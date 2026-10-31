import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** A saved CSV link still downloads; the export moved with its report (#2075). */
export const GET: RequestHandler = ({ url }) => {
	redirect(308, `/staff/reports/volunteering/export${url.search}`);
};
