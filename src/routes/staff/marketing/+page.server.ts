import { redirectToFirstView } from '../views.server';
import { marketingViews } from './views';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => redirectToFirstView(marketingViews, url);
