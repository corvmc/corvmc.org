import { redirectToFirstView } from '../../views.server';
import { transactionViews } from './views';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => redirectToFirstView(transactionViews, url);
