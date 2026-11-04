import { redirectToFirstView } from '../views.server';
import { reportViews } from './views';
import type { PageServerLoad } from './$types';

// Also the Annual report's old address: its query string carries through.
export const load: PageServerLoad = ({ url }) => redirectToFirstView(reportViews, url);
