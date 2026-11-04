import { redirectToFirstView } from '../views.server';
import { outreachViews } from './views';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => redirectToFirstView(outreachViews, url);
