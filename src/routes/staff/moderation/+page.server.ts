import { redirectToFirstView } from '../views.server';
import { moderationViews } from './views';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => redirectToFirstView(moderationViews, url);
