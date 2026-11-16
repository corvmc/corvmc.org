import { redirectToFirstView } from '../views.server';
import { contentNavItems } from '../nav-items/content';
import type { StaffView } from '../views';
import type { PageServerLoad } from './$types';

/** The Content panel's rows as views: its bare address opens the first one held. */
const contentViews: StaffView[] = contentNavItems.flatMap(({ key, label, href, capability }) =>
	href && capability ? [{ key, label: () => label, href, cap: capability }] : []
);

export const load: PageServerLoad = ({ url }) => redirectToFirstView(contentViews, url);
