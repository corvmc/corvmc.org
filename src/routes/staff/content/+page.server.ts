import { redirectToFirstView } from '../views.server';
import { contentViews } from './views';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => redirectToFirstView(contentViews, url);
