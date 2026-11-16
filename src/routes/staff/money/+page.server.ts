import { redirectToFirstView } from '../views.server';
import { moneyViews } from './views';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => redirectToFirstView(moneyViews, url);
